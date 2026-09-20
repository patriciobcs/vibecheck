import { desc, eq } from "drizzle-orm";
import { auth } from "@/auth/auth";
import { db, schema } from "@/db/client";
import { fail, route } from "@/lib/api";
import { env } from "@/lib/env";

/**
 * DEMO_MODE only: signs the seeded owner in with one click by issuing the normal magic link and
 * following it, so a recorded demo never shows the developer inbox. Refused outside demo mode
 * and always in production; the account is the local seed owner, nothing else.
 */
export const GET = route(async (req) => {
  if (!env().demo) return fail(404, "not_found");
  const email = env().SEED_OWNER_EMAIL;
  const next = new URL(req.url).searchParams.get("next") ?? "/products";
  await auth.api.signInMagicLink({
    body: { email, callbackURL: next.startsWith("/") ? next : "/products" },
    headers: req.headers,
  });
  const msg = await db.query.notificationOutbox.findFirst({
    where: eq(schema.notificationOutbox.toEmail, email),
    orderBy: desc(schema.notificationOutbox.createdAt),
  });
  if (!msg?.actionUrl) return fail(500, "magic_link_missing");
  return Response.redirect(msg.actionUrl, 302);
});
