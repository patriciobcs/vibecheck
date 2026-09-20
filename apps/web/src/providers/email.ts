import { AsyncLocalStorage } from "node:async_hooks";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { env } from "@/lib/env";
import { newId } from "@/lib/ids";

export type OutgoingEmail = { to: string; subject: string; text: string; actionUrl?: string };

const testInboxContext = new AsyncLocalStorage<boolean>();

export function withTestInbox<T>(callback: () => Promise<T>) {
  return testInboxContext.run(true, callback);
}

export async function sendEmail(message: OutgoingEmail) {
  const config = env();
  const mode = testInboxContext.getStore() ? "test_inbox" : config.EMAIL_MODE;
  if (
    mode === "test_inbox" &&
    process.env.NODE_ENV === "production" &&
    !testInboxContext.getStore()
  ) {
    throw new Error("email_delivery_not_configured");
  }
  if (mode === "resend" && (!config.RESEND_API_KEY || !config.EMAIL_FROM)) {
    throw new Error("email_delivery_not_configured");
  }
  const id = newId("mail");
  await db.insert(schema.notificationOutbox).values({
    id,
    toEmail: message.to,
    subject: message.subject,
    bodyText: message.text,
    actionUrl: message.actionUrl ?? null,
    status: mode === "test_inbox" ? "test_inbox" : "queued",
  });
  if (mode === "resend") {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.RESEND_API_KEY}`,
        "content-type": "application/json",
        "idempotency-key": id,
      },
      body: JSON.stringify({
        from: config.EMAIL_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("email_delivery_failed");
    await db
      .update(schema.notificationOutbox)
      .set({ status: "sent" })
      .where(eq(schema.notificationOutbox.id, id));
  }
  return { id, mode };
}
