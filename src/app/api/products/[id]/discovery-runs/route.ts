import { NextRequest } from "next/server";
import { tenantFromRequest, apiError } from "@/lib/auth";
import { createDiscoveryRun } from "@/services/products";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await tenantFromRequest(request);
  if (!tenantId) return apiError("authentication required", "unauthorized", 401);
  const body = await request.json().catch(() => ({}));
  const run = await createDiscoveryRun(tenantId, (await params).id, body.provider);
  if (!run) return apiError("product not found", "not_found", 404);
  return Response.json(run, { status: 202 });
}
