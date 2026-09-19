import { NextRequest } from "next/server";
import { tenantFromRequest, apiError } from "@/lib/auth";
import { db } from "@/db";
import { product } from "@/db/schema";
import { createProduct } from "@/services/products";
import { desc, eq } from "drizzle-orm";

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
    await db
      .select()
      .from(product)
      .where(eq(product.tenantId, tenantId))
      .orderBy(desc(product.createdAt)),
  );
}
