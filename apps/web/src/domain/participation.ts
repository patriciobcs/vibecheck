import { type ParticipationEvent, ParticipationEventSchema } from "@vibecheck/contracts";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { ApiError } from "@/lib/api";
import { newId } from "@/lib/ids";
import { emitEvent } from "./events";
import { enqueueSummary } from "./summaries";

export async function recordParticipation(
  tenantId: string,
  studyId: string,
  event: ParticipationEvent,
): Promise<{ created: boolean; id: string }> {
  const parsed = ParticipationEventSchema.parse(event);
  if (parsed.study_id !== studyId) throw new ApiError(422, "study_id_mismatch");
  const study = await db.query.studies.findFirst({
    where: and(eq(schema.studies.id, studyId), eq(schema.studies.tenantId, tenantId)),
  });
  if (!study) throw new ApiError(404, "study_not_found");
  if (study.status === "draft") throw new ApiError(422, "study_not_published");
  if (parsed.study_revision !== study.currentRevision)
    throw new ApiError(422, "study_revision_mismatch");

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(schema.participationEvents)
      .values({
        id: newId("participation"),
        tenantId,
        studyId,
        studyRevision: parsed.study_revision,
        eventId: parsed.event_id,
        participantRef: parsed.participant_ref,
        kind: parsed.kind,
        sessionId: parsed.session_id,
        occurredAt: new Date(parsed.occurred_at),
      })
      .onConflictDoNothing({
        target: [schema.participationEvents.tenantId, schema.participationEvents.eventId],
      })
      .returning({ id: schema.participationEvents.id });
    if (!created) {
      const existing = await tx.query.participationEvents.findFirst({
        where: and(
          eq(schema.participationEvents.tenantId, tenantId),
          eq(schema.participationEvents.eventId, parsed.event_id),
        ),
      });
      if (!existing) throw new Error("participation_insert_conflict");
      return { created: false, id: existing.id };
    }
    await emitEvent(tx, {
      type: "participation.recorded",
      tenantId,
      productId: study.productId,
      correlationId: studyId,
      idempotencyKey: `${tenantId}:participation:${parsed.event_id}`,
      payload: {
        study_id: studyId,
        study_revision: parsed.study_revision,
        participant_ref: parsed.participant_ref,
        kind: parsed.kind,
      },
    });
    if (parsed.kind === "completed" || parsed.kind === "abandoned")
      await enqueueSummary(tx, tenantId, studyId, parsed.study_revision);
    return { created: true, id: created.id };
  });
}
