import { db, schema } from "@/db/client";
import { env } from "@/lib/env";
import { newId } from "@/lib/ids";

export type OutgoingEmail = { to: string; subject: string; text: string; actionUrl?: string };

/**
 * Email adapter. EMAIL_MODE=test_inbox writes to notification_outbox and never sends;
 * messages are visible at /dev/inbox. A real provider is a future adapter (VC-06 open decision).
 */
export async function sendEmail(
  message: OutgoingEmail,
): Promise<{ id: string; mode: "test_inbox" }> {
  const mode = env().EMAIL_MODE;
  const id = newId("mail");
  await db.insert(schema.notificationOutbox).values({
    id,
    toEmail: message.to,
    subject: message.subject,
    bodyText: message.text,
    actionUrl: message.actionUrl ?? null,
    status: mode,
  });
  return { id, mode };
}
