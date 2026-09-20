import { NextRequest } from "next/server";
import { tenantFromRequest, apiError } from "@/lib/auth";
import { listJobs } from "@/services/operations";

const statuses = new Set(["pending", "running", "done", "failed", "cancelled"]);

export async function GET(request: NextRequest) {
  const tenantId = await tenantFromRequest(request);
  if (!tenantId) return apiError("authentication required", "unauthorized", 401);
  const status = new URL(request.url).searchParams.get("status") ?? undefined;
  if (status && !statuses.has(status)) return apiError("invalid status", "invalid_input", 422);
  return Response.json(
    await listJobs(tenantId, {
      status: status as "pending" | "running" | "done" | "failed" | "cancelled" | undefined,
    }),
  );
}
