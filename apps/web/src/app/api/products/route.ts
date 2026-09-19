import { desc, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { createProduct } from "@/domain/products";
import { json, route } from "@/lib/api";
import { primaryTenant, requireTenantActor } from "@/lib/tenant-access";

/** VC-01: connect a product. Suggested endpoint `POST /products`. */
export const POST = route(async (req) => {
  const actor = await requireTenantActor(req);
  const product = await createProduct(primaryTenant(actor), await req.json());
  return json(product, { status: 201 });
});

export const GET = route(async (req) => {
  const actor = await requireTenantActor(req);
  if (actor.tenantIds.length === 0) return json([]);
  return json(
    await db.query.products.findMany({
      where: inArray(schema.products.tenantId, actor.tenantIds),
      orderBy: desc(schema.products.createdAt),
    }),
  );
});
