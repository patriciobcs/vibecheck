import { NextRequest } from "next/server";
import { tenantFromRequest, apiError } from "@/lib/auth";
import { createDiscoveryRun } from "@/services/products";
import { z } from "zod";

const discoveryBodySchema = z.object({ provider: z.enum(["fixture", "devin"]).optional() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await tenantFromRequest(request);
  if (!tenantId) return apiError("authentication required", "unauthorized", 401);
  const body = discoveryBodySchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return apiError("provider must be fixture or devin");
  const run = await createDiscoveryRun(tenantId, (await params).id, body.data.provider);
  if (!run) return apiError("product not found", "not_found", 404);
  return Response.json(run, { status: 202 });
}
