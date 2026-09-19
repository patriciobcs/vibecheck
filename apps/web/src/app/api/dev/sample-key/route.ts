import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { fail, json, route } from "@/lib/api";

/** Development helper for tests: the sample product's publishable key. Disabled in production. */
export const GET = route(async () => {
  if (process.env.NODE_ENV === "production") return fail(404, "not_found");
  const product = await db.query.products.findFirst({
    where: eq(schema.products.id, "product_sample_booking"),
  });
  if (!product) return fail(404, "not_found");
  return json({ key: product.publishableKey });
});
