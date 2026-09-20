import { NextRequest } from "next/server";
import { tenantFromRequest, apiError } from "@/lib/auth";
import { cancelJob } from "@/services/operations";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await tenantFromRequest(request);
  if (!tenantId) return apiError("authentication required", "unauthorized", 401);
  const result = await cancelJob(tenantId, (await params).id);
  if (!result.ok) {
    return apiError(
      result.reason === "not_found" ? "job not found" : "job is not cancellable",
      result.reason === "not_found" ? "not_found" : "invalid_state",
      result.reason === "not_found" ? 404 : 409,
    );
  }
  return Response.json(result);
}
