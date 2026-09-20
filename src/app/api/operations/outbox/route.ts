import { NextRequest } from "next/server";
import { tenantFromRequest, apiError } from "@/lib/auth";
import { listOutbox } from "@/services/operations";

export async function GET(request: NextRequest) {
  const tenantId = await tenantFromRequest(request);
  if (!tenantId) return apiError("authentication required", "unauthorized", 401);
  return Response.json(await listOutbox(tenantId));
}
