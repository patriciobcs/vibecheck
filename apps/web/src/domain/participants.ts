import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { newId } from "@/lib/ids";

/** Every signed-in user can act as a participant; the profile is created on first use. */
export async function participantForUser(userId: string) {
  const existing = await db.query.participants.findFirst({
    where: eq(schema.participants.userId, userId),
  });
  if (existing) return existing;
  const [created] = await db
    .insert(schema.participants)
    .values({ id: newId("participant"), userId, invitationsOptIn: true })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const again = await db.query.participants.findFirst({
    where: eq(schema.participants.userId, userId),
  });
  if (!again) throw new Error("participant upsert failed");
  return again;
}

export async function membershipsForUser(userId: string) {
  return db.query.memberships.findMany({ where: eq(schema.memberships.userId, userId) });
}
