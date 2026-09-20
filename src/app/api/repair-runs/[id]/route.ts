import { NextRequest } from "next/server";
import { tenantFromRequest, apiError } from "@/lib/auth";
import { getRepairRun } from "@/services/repairs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await tenantFromRequest(request);
  if (!tenantId) return apiError("authentication required", "unauthorized", 401);
  const result = await getRepairRun((await params).id, tenantId);
  if (!result) return apiError("repair run not found", "not_found", 404);
  return Response.json(result);
}
