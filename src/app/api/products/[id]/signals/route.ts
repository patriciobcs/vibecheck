import { NextRequest } from "next/server";
import { tenantFromRequest, apiError } from "@/lib/auth";
import { signalSchema } from "@/contracts/signal";
import { listSignals, recordSignal } from "@/services/signals";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await tenantFromRequest(request);
  if (!tenantId) return apiError("authentication required", "unauthorized", 401);
  try {
    return Response.json(await listSignals(tenantId, (await params).id));
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "product not found", "not_found", 404);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await tenantFromRequest(request);
  if (!tenantId) return apiError("authentication required", "unauthorized", 401);
  const parsed = signalSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: { code: "invalid_input", message: "invalid signal", issues: parsed.error.issues } },
      { status: 422 },
    );
  }
  try {
    const result = await recordSignal(tenantId, (await params).id, parsed.data);
    return Response.json(result, { status: result.action === "created" ? 201 : 200 });
  } catch (error) {
    if (error instanceof Error && error.message === "product_not_found") {
      return apiError("product not found", "not_found", 404);
    }
    return apiError(error instanceof Error ? error.message : "invalid signal", "bad_request", 422);
  }
}
