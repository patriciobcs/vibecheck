import { StudyPlanSchema } from "@vibecheck/contracts";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { env } from "@/lib/env";
import { journeyMetrics } from "./journey-metrics";
import { currentMonitoringPolicy } from "./policy";
import type { JourneyEvent } from "./triggers";
import { buildWindow } from "./windows";

/** A row on the live board's session selector: a passive observation session or a study session. */
export type LiveSessionRef = { kind: "observation" | "study"; id: string };

export type LiveSessionSummary = LiveSessionRef & {
  label: string;
  startedAt: string;
  lastActivityAt: string;
  /** Short state word for the selector: observing, screening, evaluated… or the assignment state. */
  state: string;
  events: number;
  journeys: number;
  buildRef: string | null;
  /** True while activity is recent enough to be "happening now" for the selector. */
  live: boolean;
};

const EVENT_LIMIT = 300;
const SESSION_LIMIT = 40;
const LIVE_WINDOW_MS = 10 * 60_000;

/** Payload keys that may be echoed to the owner (all allowlisted refs; never free text). */
const SAFE_PAYLOAD_KEYS = [
  "journey_id",
  "action_ref",
  "attempt_id",
  "result",
  "error_code",
  "progress_ref",
  "route_template",
  "target_ref",
  "verification",
  "visible",
  "goal_source",
  "semantic_type",
  "safe_target_ref",
  "path",
  "key",
  "count",
  "label",
] as const;

function safePayload(payload: unknown) {
  const out: Record<string, unknown> = {};
  if (!payload || typeof payload !== "object") return out;
  for (const k of SAFE_PAYLOAD_KEYS) {
    const v = (payload as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Persisted state for the live analysis board, polled by the owner's browser: the sessions of a
 * product (passive and study) and one selected session in detail. Nothing here is simulated:
 * every row is a stored event, window, evaluation, asset or transcript segment.
 */
export async function liveBoard(productId: string, selected: LiveSessionRef | null) {
  const product = await db.query.products.findFirst({
    where: eq(schema.products.id, productId),
  });
  if (!product) throw new Error("product not found");
  const { policy, policyRef } = await currentMonitoringPolicy(productId);
  const activeDetectors = await db.$count(
    schema.detectorDefinitions,
    and(
      eq(schema.detectorDefinitions.productId, productId),
      eq(schema.detectorDefinitions.status, "active"),
    ),
  );
  const now = Date.now();
  const sessions = [
    ...(await observationSummaries(productId, now)),
    ...(await studySummaries(productId, now)),
  ]
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
    .slice(0, SESSION_LIMIT);

  // No explicit choice follows the newest session that is doing something: recording, or live
  // with events. An opened-but-silent passive session never outranks an active study.
  const fallback = pickNewest(sessions);
  const target: LiveSessionRef | null =
    selected ?? (fallback ? { kind: fallback.kind, id: fallback.id } : null);
  let detail: ObservationDetail | StudyDetail | null = null;
  if (target?.kind === "observation")
    detail = await observationDetail(
      productId,
      target.id,
      policy.window_ms,
      policy.max_input_tokens,
    );
  if (target?.kind === "study") detail = await studyDetail(productId, target.id);

  return {
    now: new Date(now).toISOString(),
    selectedRef: detail ? target : null,
    product: {
      id: product.id,
      name: product.name,
      policy: {
        enabled: policy.enabled,
        policyRef,
        batchDelayMs: policy.batch_delay_ms,
        cooldownMs: policy.cooldown_ms,
        frictionThreshold: policy.candidate_friction_threshold,
        researchThreshold: policy.candidate_research_threshold,
      },
      jev: env().jev !== null,
      devin: env().devin !== null,
      activeDetectors,
    },
    sessions,
    selected: detail,
  };
}

/** Newest session worth watching: recording first, then live with events, then anything. */
export function pickNewest(sessions: LiveSessionSummary[]): LiveSessionSummary | null {
  return (
    sessions.find((s) => s.state === "recording") ??
    sessions.find((s) => s.live && s.events > 0) ??
    sessions.find((s) => s.events > 0) ??
    sessions[0] ??
    null
  );
}

async function observationSummaries(productId: string, now: number): Promise<LiveSessionSummary[]> {
  const rows = await db
    .select({
      id: schema.observationSessions.id,
      createdAt: schema.observationSessions.createdAt,
      lastEventAt: schema.observationSessions.lastEventAt,
      buildRef: schema.observationSessions.buildRef,
      events: sql<number>`count(${schema.observationEvents.id})::int`,
      journeys: sql<number>`count(distinct ${schema.observationEvents.journeyInstanceId})::int`,
    })
    .from(schema.observationSessions)
    .leftJoin(
      schema.observationEvents,
      eq(schema.observationEvents.observationSessionId, schema.observationSessions.id),
    )
    .where(eq(schema.observationSessions.productId, productId))
    .groupBy(schema.observationSessions.id)
    .orderBy(desc(schema.observationSessions.createdAt))
    .limit(SESSION_LIMIT);
  if (rows.length === 0) return [];
  const evaluations = await db
    .select({
      sessionId: schema.observationWindows.observationSessionId,
      status: schema.jevEvaluations.status,
    })
    .from(schema.jevEvaluations)
    .innerJoin(
      schema.observationWindows,
      eq(schema.jevEvaluations.windowId, schema.observationWindows.id),
    )
    .where(
      inArray(
        schema.observationWindows.observationSessionId,
        rows.map((r) => r.id),
      ),
    );
  return rows.map((r, i) => {
    const evals = evaluations.filter((e) => e.sessionId === r.id);
    const state = evals.some((e) => e.status === "queued" || e.status === "running")
      ? "screening"
      : evals.some((e) => e.status === "completed")
        ? "evaluated"
        : r.events > 0
          ? "observing"
          : "opened";
    const last = r.lastEventAt ?? r.createdAt;
    return {
      kind: "observation" as const,
      id: r.id,
      label: `Visitor ${rows.length - i}`,
      startedAt: r.createdAt.toISOString(),
      lastActivityAt: last.toISOString(),
      state,
      events: r.events,
      journeys: r.journeys,
      buildRef: r.buildRef,
      live: now - last.getTime() < LIVE_WINDOW_MS,
    };
  });
}

async function studySummaries(productId: string, now: number): Promise<LiveSessionSummary[]> {
  const rows = await db
    .select({
      id: schema.sessions.id,
      createdAt: schema.sessions.createdAt,
      startedAt: schema.sessions.startedAt,
      endedAt: schema.sessions.endedAt,
      state: schema.assignments.state,
      events: sql<number>`count(${schema.sessionEvents.id})::int`,
      lastEventAt: sql<string | null>`max(${schema.sessionEvents.createdAt})`,
    })
    .from(schema.sessions)
    .innerJoin(schema.assignments, eq(schema.assignments.id, schema.sessions.assignmentId))
    .leftJoin(schema.sessionEvents, eq(schema.sessionEvents.sessionId, schema.sessions.id))
    .where(eq(schema.assignments.productId, productId))
    .groupBy(schema.sessions.id, schema.assignments.state)
    .orderBy(desc(schema.sessions.createdAt))
    .limit(SESSION_LIMIT);
  return rows.map((r, i) => {
    // Raw SQL aggregates come back as strings, unlike mapped columns.
    const lastEvent = r.lastEventAt ? new Date(r.lastEventAt) : null;
    const last = r.endedAt ?? lastEvent ?? r.startedAt ?? r.createdAt;
    return {
      kind: "study" as const,
      id: r.id,
      label: `Participant ${rows.length - i}`,
      startedAt: (r.startedAt ?? r.createdAt).toISOString(),
      lastActivityAt: last.toISOString(),
      state: r.state,
      events: r.events,
      journeys: 0,
      buildRef: null,
      live: r.state === "recording" || now - last.getTime() < LIVE_WINDOW_MS,
    };
  });
}

export type LiveBoardData = Awaited<ReturnType<typeof liveBoard>>;
export type ObservationDetail = Awaited<ReturnType<typeof observationDetail>>;
export type StudyDetail = Awaited<ReturnType<typeof studyDetail>>;

async function observationDetail(
  productId: string,
  sessionId: string,
  windowMs: number,
  maxInputTokens: number,
) {
  const session = await db.query.observationSessions.findFirst({
    where: and(
      eq(schema.observationSessions.id, sessionId),
      eq(schema.observationSessions.productId, productId),
    ),
  });
  if (!session) return null;
  const rows = await db.query.observationEvents.findMany({
    where: eq(schema.observationEvents.observationSessionId, session.id),
    orderBy: asc(schema.observationEvents.sequence),
    limit: EVENT_LIMIT,
  });
  const windows = await db.query.observationWindows.findMany({
    where: eq(schema.observationWindows.observationSessionId, session.id),
    orderBy: desc(schema.observationWindows.createdAt),
  });
  const evaluations = windows.length
    ? await db.query.jevEvaluations.findMany({
        where: inArray(
          schema.jevEvaluations.windowId,
          windows.map((w) => w.id),
        ),
        orderBy: desc(schema.jevEvaluations.requestedAt),
      })
    : [];
  const detectorRefs = [...new Set(evaluations.map((e) => e.detectorRef))];
  const detectors = detectorRefs.length
    ? await db.query.detectorDefinitions.findMany({
        where: eq(schema.detectorDefinitions.productId, productId),
      })
    : [];
  const candidates = evaluations.length
    ? (
        await db.query.researchCandidates.findMany({
          where: eq(schema.researchCandidates.productId, productId),
          orderBy: desc(schema.researchCandidates.updatedAt),
        })
      ).filter((c) => c.evaluationRefs.some((ref) => evaluations.some((e) => e.id === ref)))
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const journeyIds = [...new Set(rows.map((r) => r.journeyInstanceId))];
  const journeys = journeyIds.map((journeyInstanceId) => {
    const own = rows.filter((r) => r.journeyInstanceId === journeyInstanceId);
    return {
      journeyInstanceId,
      journeyId: own[0]?.journeyId ?? "",
      metrics: journeyMetrics(
        own.map((r) => ({
          id: r.id,
          sequence: r.sequence,
          t_ms: r.tMs,
          type: r.type,
          payload: r.payload as Record<string, unknown>,
        })),
      ),
    };
  });

  return {
    kind: "observation" as const,
    journeys,
    session: {
      id: session.id,
      buildRef: session.buildRef,
      createdAt: session.createdAt.toISOString(),
      lastEventAt: session.lastEventAt?.toISOString() ?? null,
      suppressedUntil: session.suppressedUntil?.toISOString() ?? null,
    },
    events: rows.map((r) => ({
      id: r.id,
      sequence: r.sequence,
      tMs: r.tMs,
      type: r.type,
      journeyInstanceId: r.journeyInstanceId,
      journeyId: r.journeyId,
      receivedAt: r.receivedAt.toISOString(),
      payload: safePayload(r.payload),
    })),
    evaluations: evaluations.map((e) => {
      const w = windows.find((x) => x.id === e.windowId);
      const detector = detectors.find((d) => `${d.detectorId}:${d.version}` === e.detectorRef);
      // Rebuild the redacted state from the immutable window so the owner sees what Jev saw.
      const events: JourneyEvent[] = (w?.eventIds ?? [])
        .map((id) => byId.get(id))
        .filter((r): r is NonNullable<typeof r> => r !== undefined)
        .map((r) => ({
          id: r.id,
          sequence: r.sequence,
          t_ms: r.tMs,
          type: r.type,
          payload: r.payload as Record<string, unknown>,
        }));
      const state =
        w && detector
          ? buildWindow(events, {
              journeyInstanceId: w.journeyInstanceId,
              observationSessionId: w.observationSessionId,
              journeyId: w.journeyId,
              buildRef: w.buildRef,
              detectorRef: e.detectorRef,
              policyRef: e.policyRef,
              requiredEvents: detector.requiredEvents,
              windowMs,
              maxInputChars: maxInputTokens * 4,
              nowMs: w.endMs,
              triggerReason: e.triggerReason,
            }).state
          : null;
      return {
        id: e.id,
        status: e.status,
        statusReason: e.statusReason,
        triggerReason: e.triggerReason,
        detectorRef: e.detectorRef,
        journeyId: w?.journeyId ?? null,
        requestedModel: e.requestedModel,
        returnedModel: e.returnedModel,
        inputTokens: e.inputTokens,
        outputTokens: e.outputTokens,
        estimatedCostMicros: e.estimatedCostMicros,
        requestedAt: e.requestedAt.toISOString(),
        completedAt: e.completedAt?.toISOString() ?? null,
        latencyMs: e.completedAt ? e.completedAt.getTime() - e.requestedAt.getTime() : null,
        answers: e.answers,
        questions: detector?.questions ?? null,
        window: w
          ? {
              id: w.id,
              journeyInstanceId: w.journeyInstanceId,
              triggerReason: w.triggerReason,
              startMs: w.startMs,
              endMs: w.endMs,
              events: w.eventIds.length,
              eventIds: w.eventIds,
              gaps: w.gaps,
              coverage: w.coverage,
              goalSource: w.goalSource,
            }
          : null,
        state,
      };
    }),
    candidates: candidates.map((c) => ({
      id: c.id,
      journeyId: c.journeyId,
      targetRef: c.targetRef,
      category: c.category,
      state: c.state,
      suspectedProblem: c.suspectedProblem,
      distinctObservationSessions: c.distinctObservationSessions,
      distinctJourneyInstances: c.distinctJourneyInstances,
      latestFrictionPermille: c.latestFrictionPermille,
      latestResearchPermille: c.latestResearchPermille,
      evidenceLimitations: c.evidenceLimitations,
      updatedAt: c.updatedAt.toISOString(),
    })),
  };
}

async function studyDetail(productId: string, sessionId: string) {
  const session = await db.query.sessions.findFirst({ where: eq(schema.sessions.id, sessionId) });
  if (!session) return null;
  const assignment = await db.query.assignments.findFirst({
    where: and(
      eq(schema.assignments.id, session.assignmentId),
      eq(schema.assignments.productId, productId),
    ),
  });
  if (!assignment) return null;
  const revision = await db.query.studyRevisions.findFirst({
    where: and(
      eq(schema.studyRevisions.studyId, assignment.studyId),
      eq(schema.studyRevisions.revision, assignment.studyRevision),
    ),
  });
  const plan = revision ? StudyPlanSchema.parse(revision.plan) : null;
  const events = await db.query.sessionEvents.findMany({
    where: eq(schema.sessionEvents.sessionId, session.id),
    orderBy: asc(schema.sessionEvents.sequence),
    limit: EVENT_LIMIT,
  });
  const assets = await db.query.assets.findMany({
    where: eq(schema.assets.sessionId, session.id),
    orderBy: asc(schema.assets.offsetMs),
  });
  const transcript = await db.query.transcriptSegments.findMany({
    where: eq(schema.transcriptSegments.sessionId, session.id),
    orderBy: asc(schema.transcriptSegments.startMs),
  });
  const semantic = events
    .filter((e) => e.type === "semantic")
    .map((e) => {
      const p = e.payload as Record<string, unknown>;
      return {
        id: e.id,
        sequence: e.sequence,
        t_ms: e.tMs,
        type: typeof p.semantic_type === "string" ? p.semantic_type : "semantic",
        payload: p,
      };
    });
  return {
    kind: "study" as const,
    metrics: journeyMetrics(semantic),
    session: {
      id: session.id,
      assignmentId: assignment.id,
      studyId: assignment.studyId,
      state: assignment.state,
      channel: assignment.channel,
      startedAt: session.startedAt?.toISOString() ?? null,
      endedAt: session.endedAt?.toISOString() ?? null,
      pauses: session.pauses,
      completeness: session.completeness,
      transcriptStatus: session.transcriptStatus,
      participantReportedOutcome: session.participantReportedOutcome,
      instrumentedOutcome: session.instrumentedOutcome,
      capture: plan?.capture ?? null,
      task: plan
        ? { prompt: plan.task.participant_prompt, question: plan.task.research_question }
        : null,
    },
    events: events.map((e) => {
      const payload = safePayload(e.payload);
      return {
        id: e.id,
        sequence: e.sequence,
        tMs: e.tMs,
        type: e.type,
        semanticType: typeof payload.semantic_type === "string" ? payload.semantic_type : null,
        receivedAt: e.createdAt.toISOString(),
        payload,
      };
    }),
    assets: assets.map((a) => ({
      id: a.id,
      kind: a.kind,
      status: a.status,
      providerStatus: a.providerStatus,
      offsetMs: a.offsetMs,
      durationMs: a.durationMs,
      sizeBytes: a.sizeBytes,
      transcriptStatus: a.transcriptStatus,
      failureReason: a.failureReason,
    })),
    transcript: transcript.map((t) => ({
      id: t.id,
      startMs: t.startMs,
      endMs: t.endMs,
      speaker: t.speaker,
      text: t.text,
      confidence: t.confidence,
    })),
  };
}
