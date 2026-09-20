import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { env } from "@/lib/env";
import { currentMonitoringPolicy } from "./policy";

/** Everything the Monitoring view shows: persisted state only, with explicit denominators. */
export async function monitoringOverview(productId: string) {
  const { policy, revision, policyRef } = await currentMonitoringPolicy(productId);
  const dayAgo = new Date(Date.now() - 24 * 60 * 60_000);
  const detectors = await db.query.detectorDefinitions.findMany({
    where: eq(schema.detectorDefinitions.productId, productId),
    orderBy: [
      desc(schema.detectorDefinitions.detectorId),
      desc(schema.detectorDefinitions.version),
    ],
  });
  const sessions = await db.$count(
    schema.observationSessions,
    eq(schema.observationSessions.productId, productId),
  );
  const recentSessions = await db.$count(
    schema.observationSessions,
    and(
      eq(schema.observationSessions.productId, productId),
      gte(schema.observationSessions.createdAt, dayAgo),
    ),
  );
  const [eventStats] = await db
    .select({
      events: sql<number>`count(*)::int`,
      journeys: sql<number>`count(distinct ${schema.observationEvents.journeyInstanceId})::int`,
      lastAt: sql<Date | null>`max(${schema.observationEvents.receivedAt})`,
    })
    .from(schema.observationEvents)
    .innerJoin(
      schema.observationSessions,
      eq(schema.observationEvents.observationSessionId, schema.observationSessions.id),
    )
    .where(eq(schema.observationSessions.productId, productId));
  const observedTypes = await db
    .selectDistinct({ type: schema.observationEvents.type })
    .from(schema.observationEvents)
    .innerJoin(
      schema.observationSessions,
      eq(schema.observationEvents.observationSessionId, schema.observationSessions.id),
    )
    .where(eq(schema.observationSessions.productId, productId));
  const lastBuild = await db.query.observationSessions.findFirst({
    where: eq(schema.observationSessions.productId, productId),
    orderBy: desc(schema.observationSessions.createdAt),
  });
  const evaluations = await db.query.jevEvaluations.findMany({
    where: eq(schema.jevEvaluations.productId, productId),
    orderBy: desc(schema.jevEvaluations.requestedAt),
    limit: 50,
  });
  const windows = evaluations.length
    ? await db.query.observationWindows.findMany({
        where: (w, { inArray }) =>
          inArray(
            w.id,
            evaluations.map((e) => e.windowId),
          ),
      })
    : [];
  const candidates = await db.query.researchCandidates.findMany({
    where: eq(schema.researchCandidates.productId, productId),
    orderBy: desc(schema.researchCandidates.updatedAt),
  });
  const links = candidates.length
    ? await db.query.candidateStudyLinks.findMany({
        where: (l, { inArray }) =>
          inArray(
            l.candidateId,
            candidates.map((c) => c.id),
          ),
      })
    : [];
  const ledger = await db.query.evaluationBudgetLedger.findFirst({
    where: and(
      eq(schema.evaluationBudgetLedger.productId, productId),
      eq(schema.evaluationBudgetLedger.day, new Date().toISOString().slice(0, 10)),
    ),
  });
  const byStatus: Record<string, number> = {};
  const byTrigger: Record<string, number> = {};
  for (const e of evaluations) {
    byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
    byTrigger[e.triggerReason] = (byTrigger[e.triggerReason] ?? 0) + 1;
  }
  return {
    policy: { revision, policyRef, ...policy },
    providers: {
      jev: env().jev !== null,
      jevPriced: env().jev?.priceMicrosPer1k != null,
      devin: env().devin !== null,
    },
    collection: {
      observationSessions: sessions,
      observationSessionsLast24h: recentSessions,
      events: eventStats?.events ?? 0,
      journeys: eventStats?.journeys ?? 0,
      lastEventAt: eventStats?.lastAt ?? null,
      observedEventTypes: observedTypes.map((t) => t.type),
      lastBuildRef: lastBuild?.buildRef ?? null,
    },
    detectors: detectors.map((d) => ({
      id: d.id,
      detectorId: d.detectorId,
      version: d.version,
      journeyId: d.journeyId,
      appBuildRef: d.appBuildRef,
      requiredEvents: d.requiredEvents,
      status: d.status,
      statusReason: d.statusReason,
      provenance: d.provenance,
      questionCount: Object.keys(d.questions as object).length,
      createdAt: d.createdAt,
    })),
    evaluations: evaluations.map((e) => {
      const w = windows.find((x) => x.id === e.windowId);
      return {
        id: e.id,
        status: e.status,
        statusReason: e.statusReason,
        triggerReason: e.triggerReason,
        detectorRef: e.detectorRef,
        requestedModel: e.requestedModel,
        returnedModel: e.returnedModel,
        inputTokens: e.inputTokens,
        outputTokens: e.outputTokens,
        estimatedCostMicros: e.estimatedCostMicros,
        requestedAt: e.requestedAt,
        completedAt: e.completedAt,
        answers: e.answers,
        window: w
          ? {
              id: w.id,
              journeyInstanceId: w.journeyInstanceId,
              startMs: w.startMs,
              endMs: w.endMs,
              events: w.eventIds.length,
              gaps: w.gaps,
              coverage: w.coverage,
              goalSource: w.goalSource,
            }
          : null,
      };
    }),
    evaluationSummary: {
      byStatus,
      byTrigger,
      today: ledger
        ? {
            evaluations: ledger.evaluations,
            inputTokens: ledger.inputTokens,
            outputTokens: ledger.outputTokens,
            estimatedCostMicros: ledger.estimatedCostMicros,
          }
        : null,
    },
    candidates: candidates.map((c) => ({
      ...c,
      studyIds: links.filter((l) => l.candidateId === c.id).map((l) => l.studyId),
    })),
  };
}
