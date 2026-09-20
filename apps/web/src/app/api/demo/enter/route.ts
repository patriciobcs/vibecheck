import { desc, eq } from "drizzle-orm";
import { auth } from "@/auth/auth";
import { db, schema } from "@/db/client";
import { fail, route } from "@/lib/api";
import { env } from "@/lib/env";

/**
 * DEMO_MODE only: one-click sign-in as a seeded demo identity by issuing the normal magic link and
 * following it, so nobody has to set up email. `as=owner` is the product owner of the demo
 * workspace, `as=tester` a participant who can take studies. Nothing else can be signed in here.
 */
export const GET = route(async (req) => {
  if (!env().demo) return fail(404, "not_found");
  const params = new URL(req.url).searchParams;
  const role = params.get("as") === "tester" ? "tester" : "owner";
  const email = role === "tester" ? env().DEMO_TESTER_EMAIL : env().SEED_OWNER_EMAIL;
  const requested = params.get("next");
  const next = requested?.startsWith("/")
    ? requested
    : role === "tester"
      ? "/marketplace"
      : "/products";
  await auth.api.signInMagicLink({ body: { email, callbackURL: next }, headers: req.headers });
  const msg = await db.query.notificationOutbox.findFirst({
    where: eq(schema.notificationOutbox.toEmail, email),
    orderBy: desc(schema.notificationOutbox.createdAt),
  });
  if (!msg?.actionUrl) return fail(500, "magic_link_missing");
  return Response.redirect(msg.actionUrl, 302);
});
