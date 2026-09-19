import { NextRequest } from "next/server";
import { tenantFromRequest, apiError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await tenantFromRequest(request);
  if (!tenantId) return apiError("authentication required", "unauthorized", 401);
  const product = await prisma.product.findFirst({ where: { id: (await params).id, tenantId }, include: { discoveryRuns: { include: { proposals: true }, orderBy: { createdAt: "desc" } } } });
  if (!product) return apiError("product not found", "not_found", 404);
  return Response.json(product);
}
