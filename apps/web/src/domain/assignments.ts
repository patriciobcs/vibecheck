import { StudyPlanSchema } from "@vibecheck/contracts";
import { and, eq, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/db/client";
import { newId } from "@/lib/ids";
import { emitEvent } from "./events";

export type AssignmentRow = typeof schema.assignments.$inferSelect;
export type Channel = "direct_link" | "embedded" | "marketplace";

export type ClaimResult =
  | { ok: true; assignment: AssignmentRow; created: boolean }
  | { ok: false; reason: "study_not_recruiting" | "study_full" | "paused" | "not_found" };

const ASSIGNMENT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Transactional claim (VC-02): locks the study row, counts live assignments against the
 * plan's target_count, snapshots revision/baseline/capture policy and reserves a fixture ref.
 * Re-claiming by the same participant returns the existing assignment.
 */
export async function claimAssignment(input: {
  studyId: string;
  participantId: string;
  channel: Channel;
}): Promise<ClaimResult> {
  return db.transaction((tx) => claimAssignmentIn(tx, input));
}

/** The claim itself, for callers that must commit it together with their own rows. */
export async function claimAssignmentIn(
  tx: Tx,
  input: { studyId: string; participantId: string; channel: Channel },
): Promise<ClaimResult> {
  {
    const [study] = await tx
      .select()
      .from(schema.studies)
      .where(eq(schema.studies.id, input.studyId))
      .for("update");
    if (!study) return { ok: false, reason: "not_found" };

    const tenant = await tx.query.tenants.findFirst({
      where: eq(schema.tenants.id, study.tenantId),
    });
    if (tenant?.paused) return { ok: false, reason: "paused" };

    const existing = await tx.query.assignments.findFirst({
      where: and(
        eq(schema.assignments.studyId, study.id),
        eq(schema.assignments.participantId, input.participantId),
      ),
    });
    if (existing) return { ok: true, assignment: existing, created: false };

    if (study.status !== "recruiting" && study.status !== "published")
      return { ok: false, reason: "study_not_recruiting" };

    const revision = await tx.query.studyRevisions.findFirst({
      where: and(
        eq(schema.studyRevisions.studyId, study.id),
        eq(schema.studyRevisions.revision, study.currentRevision),
      ),
    });
    if (!revision) return { ok: false, reason: "not_found" };
    const plan = StudyPlanSchema.parse(revision.plan);

    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.assignments)
      .where(
        and(
          eq(schema.assignments.studyId, study.id),
          sql`${schema.assignments.state} NOT IN ('expired','withdrawn')`,
        ),
      );
    if (count >= plan.recruitment.target_count) return { ok: false, reason: "study_full" };

    const id = newId("assignment");
    const now = new Date();
    const [assignment] = await tx
      .insert(schema.assignments)
      .values({
        id,
        tenantId: study.tenantId,
        productId: study.productId,
        studyId: study.id,
        studyRevision: study.currentRevision,
        participantId: input.participantId,
        channel: input.channel,
        cohort: plan.recruitment.cohort,
        testedCommitSha: plan.baseline.commit_sha,
        environmentRef: plan.baseline.environment_ref,
        fixtureRef: `${plan.task.fixture_ref}:${id}`,
        state: "assigned",
        capturePolicy: plan.capture,
        expiresAt: new Date(now.getTime() + ASSIGNMENT_TTL_MS),
      })
      .returning();
    if (!assignment) throw new Error("assignment insert returned nothing");

    if (study.status === "published")
      await tx
        .update(schema.studies)
        .set({ status: "recruiting" })
        .where(eq(schema.studies.id, study.id));

    await emitEvent(tx, {
      type: "assignment.claimed",
      tenantId: study.tenantId,
      productId: study.productId,
      correlationId: study.id,
      idempotencyKey: `${assignment.id}:claim`,
      payload: {
        assignment_id: assignment.id,
        study_id: study.id,
        study_revision: study.currentRevision,
        participant_id: input.participantId,
        channel: input.channel,
        tested_commit_sha: assignment.testedCommitSha,
      },
    });

    return { ok: true, assignment, created: true };
  }
}
