import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { issueDeviceToken } from "@/domain/device-participants";
import { fail, json, parseBody, route } from "@/lib/api";
import { clientAddress, createRateLimiter } from "@/lib/rate-limit";

const Body = z.object({ publishable_key: z.string().min(1) });

/** Unauthenticated by design (it creates the identity), so it is keyed to a product and rate limited. */
const limiter = createRateLimiter({ max: 20, windowMs: 60_000 });

/**
 * Issues an anonymous device participant for the embedded dialog. Called from the dialog iframe
 * (Seamless UX origin), so the token stays in Seamless UX-origin storage and never reaches the host page.
 */
export const POST = route(async (req) => {
  const body = await parseBody(req, Body);
  if (!limiter.allow(clientAddress(req))) return fail(429, "rate_limited");
  const product = await db.query.products.findFirst({
    where: eq(schema.products.publishableKey, body.publishable_key),
  });
  if (!product) return fail(404, "unknown_key");
  const { token } = await issueDeviceToken();
  return json({ device_token: token });
});
