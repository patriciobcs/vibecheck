import { NextRequest } from "next/server";
import { tenantFromRequest, apiError } from "@/lib/auth";
import { publishStudy } from "@/services/studies";
import { z } from "zod";

export async function POST(request: NextRequest) {
  const tenantId = await tenantFromRequest(request);
  if (!tenantId) return apiError("authentication required", "unauthorized", 401);
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) return apiError("Idempotency-Key is required");
  try {
    const result = await publishStudy(tenantId, idempotencyKey, await request.json());
    if (!result) return apiError("product, run, or proposal not found", "not_found", 404);
    return Response.json(result, { status: result.status });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: { code: "invalid_input", message: "invalid study input", issues: error.issues } },
        { status: 400 },
      );
    }
    return apiError(error instanceof Error ? error.message : "invalid study");
  }
}
