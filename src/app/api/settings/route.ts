import { NextRequest } from "next/server";
import { tenantFromRequest, apiError } from "@/lib/auth";
import { isPaused } from "@/services/settings";

export async function GET(request: NextRequest) {
  const tenantId = await tenantFromRequest(request);
  if (!tenantId) return apiError("authentication required", "unauthorized", 401);
  const pausedAt = await isPaused(tenantId);
  return Response.json({ paused_at: pausedAt?.toISOString() ?? null });
}
