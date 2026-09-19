import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { fail, json, route } from "@/lib/api";

/** Development helper for end-to-end tests: returns the latest magic link for an email. Disabled in production. */
export const GET = route(async (req) => {
  if (process.env.NODE_ENV === "production") return fail(404, "not_found");
  const email = new URL(req.url).searchParams.get("email");
  if (!email) return fail(400, "email_required");
  const msg = await db.query.notificationOutbox.findFirst({
    where: eq(schema.notificationOutbox.toEmail, email),
    orderBy: desc(schema.notificationOutbox.createdAt),
  });
  if (!msg?.actionUrl) return fail(404, "not_found");
  return json({ url: msg.actionUrl });
});
