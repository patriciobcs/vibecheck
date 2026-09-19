import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { newId, newToken } from "@/lib/ids";

const hash = (t: string) => createHash("sha256").update(t).digest("hex");

/**
 * Anonymous participants for the embedded channel. The dialog iframe keeps the raw token;
 * the database stores only its hash. No email, no account; cooldowns and credits key off this row.
 */
export async function issueDeviceToken(): Promise<{ token: string; participantId: string }> {
  const token = `dev_${newToken(32)}`;
  const [row] = await db
    .insert(schema.participants)
    .values({
      id: newId("participant"),
      userId: null,
      deviceTokenHash: hash(token),
      invitationsOptIn: true,
    })
    .returning();
  if (!row) throw new Error("device participant insert failed");
  return { token, participantId: row.id };
}

export async function deviceParticipant(token: string) {
  if (!token.startsWith("dev_")) return null;
  return (
    (await db.query.participants.findFirst({
      where: eq(schema.participants.deviceTokenHash, hash(token)),
    })) ?? null
  );
}
