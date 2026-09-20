import { createHash } from "node:crypto";
import { type ProductConfig, ProductConfigSchema } from "@vibecheck/contracts";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema, type Tx } from "@/db/client";
import { ApiError } from "@/lib/api-error";
import { assertAllowedDestination } from "@/lib/destination";
import { newId, newToken } from "@/lib/ids";
import type { DiscoveryProviderName } from "@/providers/discovery/types";
import { enqueueJob } from "./jobs";

export type ProductRow = typeof schema.products.$inferSelect;
type Resolver = Parameters<typeof assertAllowedDestination>[1];

/**
 * VC-01 product onboarding. A failed destination check does not reject the create: the product is
 * stored as `needs_setup` with the reason so the owner sees an actionable error.
 */
export async function createProduct(
  tenantId: string,
  input: unknown,
  resolver?: Resolver,
  database: typeof db | Tx = db,
): Promise<ProductRow> {
  const config = ProductConfigSchema.parse(input);
  let status: "ready" | "needs_setup" = "ready";
  let setupError: string | null = null;
  try {
    if (!config.url) throw new Error("app_url_required");
    await assertAllowedDestination(config.url, resolver);
    for (const origin of config.permitted_origins) await assertAllowedDestination(origin, resolver);
  } catch (err) {
    status = "needs_setup";
    setupError = err instanceof Error ? err.message : "destination_not_allowed";
  }
  const [created] = await database
    .insert(schema.products)
    .values({
      id: newId("product"),
      tenantId,
      name: config.name,
      url: config.url,
      permittedOrigins: config.permitted_origins,
      publishableKey: `pk_${newToken(12)}`,
      description: config.description,
      language: config.language,
      audience: config.audience,
      repoBinding: config.repo_binding ?? null,
      releaseNotes: config.release_notes,
      supportComplaints: config.support_complaints,
      knownJourneys: config.known_journeys,
      productEvents: config.product_events,
      status,
      setupError,
    })
    .returning();
  if (!created) throw new Error("product insert failed");
  return created;
}

export function toProductConfig(p: ProductRow): ProductConfig {
  return ProductConfigSchema.parse({
    name: p.name,
    description: p.description,
    url: p.url,
    permitted_origins: p.permittedOrigins,
    language: p.language,
    audience: p.audience,
    repo_binding: p.repoBinding ?? undefined,
    release_notes: p.releaseNotes,
    support_complaints: p.supportComplaints,
    known_journeys: p.knownJourneys,
    product_events: p.productEvents,
  });
}

/** SHA-256 of the configuration at run creation; the agent must echo it so stale output cannot attach. */
export function sourceRevision(config: ProductConfig): string {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

export async function productForTenant(tenantId: string, productId: string) {
  return db.query.products.findFirst({
    where: and(eq(schema.products.id, productId), eq(schema.products.tenantId, tenantId)),
  });
}

export async function createDiscoveryRun(
  tenantId: string,
  productId: string,
  provider: DiscoveryProviderName,
  opts: { sourceCandidateRefs?: string[] } = {},
) {
  const product = await productForTenant(tenantId, productId);
  if (!product) return null;
  if (!product.url) {
    throw new ApiError(409, "app_url_required", "Add a live app URL before running research.");
  }
  const [run] = await db
    .insert(schema.discoveryRuns)
    .values({
      id: newId("discovery"),
      tenantId,
      productId,
      status: "queued",
      provider,
      sourceRevision: sourceRevision(toProductConfig(product)),
      rawResponses: [],
      sourceCandidateRefs: opts.sourceCandidateRefs ?? [],
    })
    .returning();
  if (!run) throw new Error("discovery run insert failed");
  await enqueueJob({
    type: "discovery.run",
    tenantId,
    payload: { runId: run.id, tenantId },
    dedupeKey: `discovery.run:${run.id}`,
    maxAttempts: 3,
  });
  return run;
}

export async function setProductAppUrl(
  userId: string,
  productId: string,
  input: string,
  resolver?: Resolver,
) {
  const parsed = ProductConfigSchema.shape.url.safeParse(input.trim());
  if (!parsed.success || !parsed.data || !/^https?:\/\//.test(parsed.data)) {
    throw new ApiError(400, "invalid_url", "Enter a valid http:// or https:// app URL.");
  }
  const memberships = await db.query.memberships.findMany({
    where: eq(schema.memberships.userId, userId),
  });
  const product = await db.query.products.findFirst({
    where: eq(schema.products.id, productId),
  });
  if (
    !product ||
    !memberships.some(
      (m) => m.tenantId === product.tenantId && ["owner", "admin", "researcher"].includes(m.role),
    )
  ) {
    throw new ApiError(403, "forbidden", "You cannot configure this project.");
  }
  if (product.url) {
    throw new ApiError(409, "app_url_already_set", "This project already has an app URL.");
  }
  const origins = product.permittedOrigins.length
    ? product.permittedOrigins
    : [new URL(parsed.data).origin];
  try {
    await assertAllowedDestination(parsed.data, resolver);
    for (const origin of origins) await assertAllowedDestination(origin, resolver);
  } catch {
    throw new ApiError(400, "destination_not_allowed", "Use an app URL reachable by participants.");
  }
  const [updated] = await db
    .update(schema.products)
    .set({ url: parsed.data, permittedOrigins: origins, status: "ready", setupError: null })
    .where(
      and(
        eq(schema.products.id, productId),
        eq(schema.products.tenantId, product.tenantId),
        isNull(schema.products.url),
      ),
    )
    .returning({ id: schema.products.id });
  if (!updated) {
    throw new ApiError(409, "app_url_already_set", "This project already has an app URL.");
  }
}
