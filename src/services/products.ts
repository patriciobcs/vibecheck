import { createHash, randomUUID } from "node:crypto";
import { Prisma, type Product } from "@prisma/client";
import { productConfigSchema, type ProductConfig } from "@/contracts/productConfig";
import type { DiscoveryProviderName } from "@/agents/types";
import { prisma } from "@/lib/prisma";
import { assertAllowedDestination } from "@/lib/destination";

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
  return prisma.product.create({
    data: {
      tenantId,
      name: config.name,
      description: config.description,
      url: config.url,
      permittedOrigins: config.permitted_origins,
      language: config.language,
      audience: config.audience,
      repoBinding: config.repo_binding as Prisma.InputJsonValue | undefined,
      releaseNotes: config.release_notes as Prisma.InputJsonValue,
      supportComplaints: config.support_complaints as Prisma.InputJsonValue,
      knownJourneys: config.known_journeys as Prisma.InputJsonValue,
      productEvents: config.product_events as Prisma.InputJsonValue,
      status,
      setupError,
    },
  });
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
  const product = await prisma.product.findFirst({ where: { id: productId, tenantId } });
  if (!product) return null;
  const config = toProductConfig(product);
  const run = await prisma.discoveryRun.create({
    data: {
      tenantId,
      productId,
      status: "queued",
      provider,
      sourceRevision: sourceRevision(config),
      rawResponses: [],
    },
  });
  await prisma.job.create({
    data: { tenantId, type: "discovery.run", payload: { runId: run.id } },
  });
  return run;
}
