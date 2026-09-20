import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { outboxEvent, participationEvent, study } from "@/db/schema";
import { participationEventSchema, type ParticipationEvent } from "@/contracts/participation";
import { enqueueSummary } from "./summaries";

export async function recordParticipation(
  tenantId: string,
  studyId: string,
  event: ParticipationEvent,
) {
  const parsed = participationEventSchema.parse(event);
  if (parsed.study_id !== studyId) throw new Error("study_id_mismatch");
  const [studyRow] = await db
    .select()
    .from(study)
    .where(and(eq(study.id, studyId), eq(study.tenantId, tenantId)))
    .limit(1);
  if (!studyRow) throw new Error("study_not_found");
  if (studyRow.status !== "published") throw new Error("study_not_published");
  if (parsed.study_revision !== studyRow.currentRevision)
    throw new Error("study_revision_mismatch");

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(participationEvent)
      .values({
        tenantId,
        studyId,
        studyRevision: parsed.study_revision,
        eventId: parsed.event_id,
        participantRef: parsed.participant_ref,
        kind: parsed.kind,
        sessionId: parsed.session_id,
        occurredAt: new Date(parsed.occurred_at),
      })
      .onConflictDoNothing()
      .returning({ id: participationEvent.id });
    if (!created) return { created: false };
    await tx
      .insert(outboxEvent)
      .values({
        eventId: randomUUID(),
        eventType: "participation.recorded",
        idempotencyKey: `${tenantId}:participation:${parsed.event_id}`,
        tenantId,
        productId: studyRow.productId,
        correlationId: studyId,
        payload: {
          study_id: studyId,
          study_revision: parsed.study_revision,
          participant_ref: parsed.participant_ref,
          kind: parsed.kind,
        },
        occurredAt: new Date(parsed.occurred_at),
      })
      .onConflictDoNothing({ target: outboxEvent.idempotencyKey });
    if (parsed.kind === "completed" || parsed.kind === "abandoned") {
      await enqueueSummary(tx, tenantId, studyId, parsed.study_revision);
    }
    return { created: true };
  });
}
