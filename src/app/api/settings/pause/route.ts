import { NextRequest } from "next/server";
import { z } from "zod";
import { tenantFromRequest, apiError } from "@/lib/auth";
import { pauseTenant, resumeTenant } from "@/services/settings";

const pauseBodySchema = z.object({ reason: z.string().max(500).optional() });

export async function POST(request: NextRequest) {
  const tenantId = await tenantFromRequest(request);
  if (!tenantId) return apiError("authentication required", "unauthorized", 401);
  const body = pauseBodySchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return apiError("invalid pause request", "invalid_input", 422);
  try {
    const result = await pauseTenant(tenantId, body.data.reason ?? null);
    return Response.json({
      paused_at: result.pausedAt?.toISOString() ?? null,
      action: result.action,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "tenant_not_found") {
      return apiError("tenant not found", "not_found", 404);
    }
    return apiError(error instanceof Error ? error.message : "pause failed");
  }
}

export async function DELETE(request: NextRequest) {
  const tenantId = await tenantFromRequest(request);
  if (!tenantId) return apiError("authentication required", "unauthorized", 401);
  const result = await resumeTenant(tenantId);
  return Response.json({ paused_at: result.pausedAt, action: result.action });
}
