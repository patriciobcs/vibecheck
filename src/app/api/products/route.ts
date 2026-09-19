import { NextRequest } from "next/server";
import { tenantFromRequest, apiError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createProduct } from "@/services/products";

export async function POST(request: NextRequest) {
  const tenantId = await tenantFromRequest(request);
  if (!tenantId) return apiError("authentication required", "unauthorized", 401);
  try {
    return Response.json(await createProduct(tenantId, await request.json()), { status: 201 });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "invalid product");
  }
}

export async function GET(request: NextRequest) {
  const tenantId = await tenantFromRequest(request);
  if (!tenantId) return apiError("authentication required", "unauthorized", 401);
  return Response.json(
    await prisma.product.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } }),
  );
}
