import { NextRequest } from "next/server";
import { tenantFromRequest, apiError } from "@/lib/auth";
import { productOverview } from "@/services/overview";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await tenantFromRequest(request);
  if (!tenantId) return apiError("authentication required", "unauthorized", 401);
  try {
    return Response.json(await productOverview(tenantId, (await params).id));
  } catch (error) {
    if (error instanceof Error && error.message === "product_not_found") {
      return apiError("product not found", "not_found", 404);
    }
    return apiError(error instanceof Error ? error.message : "overview failed");
  }
}
