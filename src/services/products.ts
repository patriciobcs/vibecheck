import { createHash, randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { productConfigSchema, type ProductConfig } from "@/contracts/productConfig";
import type { DiscoveryProviderName } from "@/agents/types";
import { db } from "@/db";
import { discoveryRun, job, product } from "@/db/schema";
import { assertAllowedDestination } from "@/lib/destination";
import type { Product } from "@/db/schema";

export async function createProduct(tenantId: string, input: unknown) {
  const config = productConfigSchema.parse(input);
  let status: "ready" | "needs_setup" = "ready";
  let setupError: string | undefined;
  try {
    await assertAllowedDestination(config.url);
    for (const origin of config.permitted_origins) await assertAllowedDestination(origin);
  } catch (error) {
    status = "needs_setup";
    setupError = error instanceof Error ? error.message : "destination_not_allowed";
  }
  const [created] = await db
    .insert(product)
    .values({
      tenantId,
      name: config.name,
      description: config.description,
      url: config.url,
      permittedOrigins: config.permitted_origins,
      language: config.language,
      audience: config.audience,
      repoBinding: config.repo_binding,
      releaseNotes: config.release_notes,
      supportComplaints: config.support_complaints,
      knownJourneys: config.known_journeys,
      productEvents: config.product_events,
      status,
      setupError,
    })
    .returning();
  return created;
}

export function sourceRevision(product: ProductConfig) {
  return createHash("sha256").update(JSON.stringify(product)).digest("hex");
}

export function toProductConfig(product: Product): ProductConfig {
  return productConfigSchema.parse({
    name: product.name,
    description: product.description,
    url: product.url,
    permitted_origins: product.permittedOrigins,
    language: product.language,
    audience: product.audience,
    repo_binding: product.repoBinding ?? undefined,
    release_notes: product.releaseNotes,
    support_complaints: product.supportComplaints,
    known_journeys: product.knownJourneys,
    product_events: product.productEvents,
  });
}

export async function createDiscoveryRun(
  tenantId: string,
  productId: string,
  provider: DiscoveryProviderName,
) {
  const [found] = await db
    .select()
    .from(product)
    .where(and(eq(product.id, productId), eq(product.tenantId, tenantId)))
    .limit(1);
  if (!found) return null;
  const config = toProductConfig(found);
  const [run] = await db
    .insert(discoveryRun)
    .values({
      tenantId,
      productId,
      status: "queued",
      provider,
      sourceRevision: sourceRevision(config),
      rawResponses: [],
    })
    .returning();
  await db.insert(job).values({ tenantId, type: "discovery.run", payload: { runId: run.id } });
  return run;
}
