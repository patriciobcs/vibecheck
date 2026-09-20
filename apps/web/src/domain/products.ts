import { createHash } from "node:crypto";
import { type ProductConfig, ProductConfigSchema } from "@vibecheck/contracts";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { assertAllowedDestination } from "@/lib/destination";
import { newId, newToken } from "@/lib/ids";
import { slugify } from "@/lib/slug";
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
): Promise<ProductRow> {
  const config = ProductConfigSchema.parse(input);
  let status: "ready" | "needs_setup" = "ready";
  let setupError: string | null = null;
  try {
    await assertAllowedDestination(config.url, resolver);
    for (const origin of config.permitted_origins) await assertAllowedDestination(origin, resolver);
  } catch (err) {
    status = "needs_setup";
    setupError = err instanceof Error ? err.message : "destination_not_allowed";
  }
  const baseSlug = slugify(config.name);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
    try {
      const [created] = await db
        .insert(schema.products)
        .values({
          id: newId("product"),
          tenantId,
          name: config.name,
          slug,
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
    } catch (err) {
      // drizzle wraps the PostgresError; the violation details sit on `cause`.
      const e = err as {
        code?: string;
        constraint_name?: string;
        cause?: { code?: string; constraint_name?: string };
      };
      const code = e.code ?? e.cause?.code;
      const constraint = e.constraint_name ?? e.cause?.constraint_name;
      if (code === "23505" && constraint === "products_tenant_slug_uq") continue;
      throw err;
    }
  }
  throw new Error(`could not allocate a slug for product "${config.name}"`);
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
