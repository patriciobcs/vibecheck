import { and, eq, inArray } from "drizzle-orm";
import { db, schema, type Tx } from "@/db/client";
import { newId } from "@/lib/ids";
import { emitEvent } from "../events";

export type CandidateRow = typeof schema.researchCandidates.$inferSelect;

type Gate = {
  friction: number;
  research: number;
  evidence: "sufficient" | "partial" | "insufficient";
  category: string;
};

/**
 * Candidate gate (VC-03 "Routing and interpretation"): evidence sufficient or partial, both nouls
 * above thresholds, and at least one resolvable source event. Low scores mean "no candidate from this
 * evaluation", never proof that the UX is fine.
 */
export function passesCandidateGate(
  g: Gate,
  thresholds: { friction: number; research: number },
  sourceEventCount: number,
): boolean {
  return (
    g.evidence !== "insufficient" &&
    g.friction >= thresholds.friction &&
    g.research >= thresholds.research &&
    sourceEventCount > 0
  );
}

/**
 * Groups by product, journey, target, category, build and detector version. Counts distinct
 * observation sessions and journey instances, never windows or assumed people.
 */
export async function upsertCandidate(
  tx: Tx,
  input: {
    tenantId: string;
    productId: string;
    journeyId: string;
    targetRef: string;
    category: string;
    buildRef: string;
    detectorRef: string;
    evaluationId: string;
    supportingEventIds: string[];
    limitations: string[];
    friction: number;
    research: number;
    suspectedProblem: string;
  },
): Promise<CandidateRow> {
  const existing = await tx.query.researchCandidates.findFirst({
    where: and(
      eq(schema.researchCandidates.productId, input.productId),
      eq(schema.researchCandidates.journeyId, input.journeyId),
      eq(schema.researchCandidates.targetRef, input.targetRef),
      eq(schema.researchCandidates.category, input.category),
      eq(schema.researchCandidates.baselineBuildRef, input.buildRef),
      eq(schema.researchCandidates.detectorRef, input.detectorRef),
    ),
  });
  const evaluationRefs = [...new Set([...(existing?.evaluationRefs ?? []), input.evaluationId])];
  const evals = await tx.query.jevEvaluations.findMany({
    where: inArray(schema.jevEvaluations.id, evaluationRefs),
  });
  const windows = evals.length
    ? await tx.query.observationWindows.findMany({
        where: inArray(
          schema.observationWindows.id,
          evals.map((e) => e.windowId),
        ),
      })
    : [];
  const distinctSessions = new Set(windows.map((w) => w.observationSessionId)).size;
  const distinctJourneys = new Set(windows.map((w) => w.journeyInstanceId)).size;
  const values = {
    evaluationRefs,
    supportingEventRefs: [
      ...new Set([...(existing?.supportingEventRefs ?? []), ...input.supportingEventIds]),
    ].slice(0, 200),
    evidenceLimitations: [
      ...new Set([...(existing?.evidenceLimitations ?? []), ...input.limitations]),
    ],
    distinctObservationSessions: distinctSessions,
    distinctJourneyInstances: distinctJourneys,
    latestFrictionPermille: Math.round(input.friction * 1000),
    latestResearchPermille: Math.round(input.research * 1000),
    suspectedProblem: input.suspectedProblem,
    updatedAt: new Date(),
  };
  let row: CandidateRow | undefined;
  if (existing) {
    // Dismissed or linked candidates keep their state; new evidence only updates counts and history.
    [row] = await tx
      .update(schema.researchCandidates)
      .set(values)
      .where(eq(schema.researchCandidates.id, existing.id))
      .returning();
  } else {
    [row] = await tx
      .insert(schema.researchCandidates)
      .values({
        id: newId("candidate"),
        tenantId: input.tenantId,
        productId: input.productId,
        journeyId: input.journeyId,
        targetRef: input.targetRef,
        category: input.category,
        baselineBuildRef: input.buildRef,
        detectorRef: input.detectorRef,
        state: "proposed",
        ...values,
      })
      .returning();
  }
  if (!row) throw new Error("candidate upsert failed");
  await emitEvent(tx, {
    type: "research_candidate.updated",
    tenantId: input.tenantId,
    productId: input.productId,
    correlationId: row.id,
    idempotencyKey: `${row.id}:${input.evaluationId}:updated`,
    payload: {
      candidate_id: row.id,
      state: row.state,
      journey_id: row.journeyId,
      category: row.category,
      distinct_observation_sessions: row.distinctObservationSessions,
      evaluation_id: input.evaluationId,
    },
  });
  return row;
}

export async function dismissCandidate(candidateId: string, reason: string, userId: string | null) {
  const [row] = await db
    .update(schema.researchCandidates)
    .set({ state: "dismissed", stateReason: reason, updatedAt: new Date() })
    .where(eq(schema.researchCandidates.id, candidateId))
    .returning();
  if (row) {
    await db.insert(schema.auditEvents).values({
      id: newId("audit"),
      tenantId: row.tenantId,
      actorUserId: userId,
      action: "research_candidate.dismissed",
      subjectType: "research_candidate",
      subjectId: row.id,
      detail: { reason },
    });
  }
  return row ?? null;
}

export async function acceptCandidate(candidateId: string, userId: string | null) {
  const [row] = await db
    .update(schema.researchCandidates)
    .set({ state: "accepted", stateReason: null, updatedAt: new Date() })
    .where(eq(schema.researchCandidates.id, candidateId))
    .returning();
  if (row)
    await db.insert(schema.auditEvents).values({
      id: newId("audit"),
      tenantId: row.tenantId,
      actorUserId: userId,
      action: "research_candidate.accepted",
      subjectType: "research_candidate",
      subjectId: row.id,
      detail: null,
    });
  return row ?? null;
}

/** Candidate → study provenance survives later dismissal or supersession. */
export async function linkCandidateToStudy(candidateId: string, studyId: string) {
  await db
    .insert(schema.candidateStudyLinks)
    .values({ id: newId("cslink"), candidateId, studyId })
    .onConflictDoNothing();
  await db
    .update(schema.researchCandidates)
    .set({ state: "study_linked", updatedAt: new Date() })
    .where(
      and(
        eq(schema.researchCandidates.id, candidateId),
        inArray(schema.researchCandidates.state, ["proposed", "accepted"]),
      ),
    );
}
