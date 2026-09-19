import { NextRequest } from "next/server";
import { tenantFromRequest, apiError } from "@/lib/auth";
import { createDiscoveryRun } from "@/services/products";
import { discoveryProviderSchema } from "@/agents/types";
import { z } from "zod";

const discoveryBodySchema = z.object({ provider: discoveryProviderSchema.optional() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await tenantFromRequest(request);
  if (!tenantId) return apiError("authentication required", "unauthorized", 401);
  const body = discoveryBodySchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return apiError(body.error.message);
  try {
    const provider = discoveryProviderSchema.parse(
      body.data.provider ?? process.env.DISCOVERY_PROVIDER ?? "fixture",
    );
    const run = await createDiscoveryRun(tenantId, (await params).id, provider);
    if (!run) return apiError("product not found", "not_found", 404);
    return Response.json(run, { status: 202 });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "invalid provider");
  }
}
