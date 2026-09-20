import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";

const BASE_HEADERS = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-VibeCheck-Key",
  "Access-Control-Max-Age": "600",
  Vary: "Origin",
};

/** CORS for SDK endpoints: only origins explicitly permitted for the product's publishable key. */
export async function corsHeadersFor(
  publishableKey: string | null,
  origin: string | null,
): Promise<Record<string, string> | null> {
  if (!publishableKey || !origin) return null;
  const product = await db.query.products.findFirst({
    where: eq(schema.products.publishableKey, publishableKey),
  });
  if (!product?.permittedOrigins.includes(origin)) return null;
  return { "Access-Control-Allow-Origin": origin, ...BASE_HEADERS };
}

/**
 * Preflight requests carry no custom headers, so the key is unknown here. Allow the preflight
 * when the Origin is permitted for at least one product; the real request still checks the key.
 */
export async function preflight(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return new Response(null, { status: 403 });
  const [match] = await db
    .select({ id: schema.products.id })
    .from(schema.products)
    .where(sql`${schema.products.permittedOrigins} @> ${JSON.stringify([origin])}::jsonb`)
    .limit(1);
  if (!match) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: { "Access-Control-Allow-Origin": origin, ...BASE_HEADERS },
  });
}

export function withCors(res: Response, headers: Record<string, string> | null): Response {
  if (!headers) return res;
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}
