import { StudyPlanSchema } from "@vibecheck/contracts";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { participantForUser } from "./participants";
import { sessionForAssignment } from "./sessions";

export async function assignmentViewForUser(userId: string, assignmentId: string) {
  const participant = await participantForUser(userId);
  return assignmentViewForParticipant(participant.id, assignmentId);
}

/** Everything the participant dialog needs, scoped to the acting participant. */
export async function assignmentViewForParticipant(participantId: string, assignmentId: string) {
  const assignment = await db.query.assignments.findFirst({
    where: and(
      eq(schema.assignments.id, assignmentId),
      eq(schema.assignments.participantId, participantId),
    ),
  });
  if (!assignment) return null;
  const revision = await db.query.studyRevisions.findFirst({
    where: and(
      eq(schema.studyRevisions.studyId, assignment.studyId),
      eq(schema.studyRevisions.revision, assignment.studyRevision),
    ),
  });
  const product = await db.query.products.findFirst({
    where: eq(schema.products.id, assignment.productId),
  });
  if (!revision || !product?.url) return null;
  const plan = StudyPlanSchema.parse(revision.plan);
  const media = await sessionForAssignment(assignment.id);
  return {
    participantId,
    assignment: {
      id: assignment.id,
      state: assignment.state,
      channel: assignment.channel,
      consentVersion: assignment.consentVersion,
      capturePolicy: plan.capture,
      expiresAt: assignment.expiresAt.toISOString(),
      testedCommitSha: assignment.testedCommitSha,
    },
    task: {
      participantPrompt: plan.task.participant_prompt,
      timeLimitSeconds: plan.task.time_limit_seconds,
      scenario: plan.task.scenario ?? null,
    },
    product: {
      name: product.name,
      url: product.url,
      sample: product.sample,
      permittedOrigins: product.permittedOrigins,
      embedMode: product.embedMode,
    },
    session: media
      ? {
          id: media.session.id,
          mediaSessionId: media.session.mediaSessionId,
          clientClockOriginMs: media.session.clientClockOriginMs,
          pauses: media.session.pauses,
          completeness: media.session.completeness,
        }
      : null,
  };
}

export type AssignmentView = NonNullable<Awaited<ReturnType<typeof assignmentViewForParticipant>>>;
