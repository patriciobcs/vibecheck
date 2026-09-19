import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { env } from "@/lib/env";
import { newId } from "@/lib/ids";
import { emitEvent } from "../events";
import { enqueueJob } from "../jobs";
import { reserveEvaluation } from "./budget";
import { activeDetectorsForJourney, detectorRef } from "./detectors";
import { currentMonitoringPolicy } from "./policy";
import { evaluateTriggers, type JourneyEvent, type Trigger } from "./triggers";
import { buildWindow } from "./windows";

export type ScanResult = {
  action: "evaluation_queued" | "unchanged_window" | "deferred" | "skipped" | "no_trigger";
  reason?: string;
  detectorId?: string;
  evaluationId?: string;
};

const CHARS_PER_TOKEN = 4;

async function journeyEvents(journeyInstanceId: string): Promise<JourneyEvent[]> {
  const rows = await db.query.observationEvents.findMany({
    where: eq(schema.observationEvents.journeyInstanceId, journeyInstanceId),
    orderBy: asc(schema.observationEvents.sequence),
  });
  return rows.map((r) => ({
    id: r.id,
    sequence: r.sequence,
    t_ms: r.tMs,
    type: r.type,
    payload: r.payload as Record<string, unknown>,
  }));
}

/**
 * Deterministic screening for one journey instance: applies the trigger policy, cooldown and
 * in-flight rules, builds a bounded window per active detector, deduplicates by content, reserves
 * budget, and queues one `jev.evaluate` job. The model never schedules itself.
 */
export async function scanJourney(input: {
  journeyInstanceId: string;
  observationSessionId: string;
  productId: string;
  nowMs?: number;
}): Promise<ScanResult[]> {
  const { policy, policyRef } = await currentMonitoringPolicy(input.productId);
  if (!policy.enabled) return [{ action: "skipped", reason: "monitoring_disabled" }];
  const session = await db.query.observationSessions.findFirst({
    where: eq(schema.observationSessions.id, input.observationSessionId),
  });
  if (!session) return [{ action: "skipped", reason: "session_not_found" }];
  const tenant = await db.query.tenants.findFirst({
    where: eq(schema.tenants.id, session.tenantId),
  });
  if (tenant?.paused) return [{ action: "skipped", reason: "tenant_paused" }];

  const events = await journeyEvents(input.journeyInstanceId);
  const first = events[0];
  if (!first) return [{ action: "skipped", reason: "no_events" }];
  const journeyId =
    (
      await db.query.observationEvents.findFirst({
        where: eq(schema.observationEvents.id, first.id),
      })
    )?.journeyId ?? "";
  const lastReceived = await db.query.observationEvents.findFirst({
    where: eq(schema.observationEvents.journeyInstanceId, input.journeyInstanceId),
    orderBy: (e, { desc }) => desc(e.receivedAt),
  });
  // The journey clock: "now" is the last event time plus wall-clock elapsed since it arrived.
  const nowMs =
    input.nowMs ??
    (lastReceived
      ? lastReceived.tMs + Math.max(0, Date.now() - lastReceived.receivedAt.getTime())
      : (events.at(-1)?.t_ms ?? 0));

  const triggers = evaluateTriggers(events, {
    nowMs,
    policy,
    journeyInstanceId: input.journeyInstanceId,
  });
  if (triggers.length === 0) return [{ action: "no_trigger" }];
  const primary = pickTrigger(triggers);

  const detectors = await activeDetectorsForJourney(input.productId, journeyId, session.buildRef);
  if (detectors.length === 0)
    return [{ action: "skipped", reason: "no_active_detector_for_build" }];

  // Cooldown and single in-flight evaluation per journey instance, across its detectors.
  const recent = await db
    .select({
      id: schema.jevEvaluations.id,
      status: schema.jevEvaluations.status,
      requestedAt: schema.jevEvaluations.requestedAt,
    })
    .from(schema.jevEvaluations)
    .innerJoin(
      schema.observationWindows,
      eq(schema.jevEvaluations.windowId, schema.observationWindows.id),
    )
    .where(eq(schema.observationWindows.journeyInstanceId, input.journeyInstanceId));
  const inFlight = recent.some((r) => r.status === "queued" || r.status === "running");
  const lastAt = recent.reduce((m, r) => Math.max(m, r.requestedAt.getTime()), 0);
  const inCooldown = lastAt > 0 && Date.now() - lastAt < policy.cooldown_ms;

  const results: ScanResult[] = [];
  for (const detector of detectors) {
    const ref = detectorRef(detector);
    const observedTypes = new Set(events.map((e) => e.type));
    const missing = detector.requiredEvents.filter(
      (r) =>
        !observedTypes.has(r) &&
        ![
          "completion",
          "exit",
          "help_request",
          "validation_error",
          "action_result",
          "action_attempt",
        ].includes(r),
    );
    if (missing.length) {
      results.push({
        action: "deferred",
        reason: `needs_instrumentation: ${missing.join(", ")}`,
        detectorId: detector.detectorId,
      });
      continue;
    }
    const built = buildWindow(events, {
      journeyInstanceId: input.journeyInstanceId,
      observationSessionId: session.id,
      journeyId,
      buildRef: session.buildRef,
      detectorRef: ref,
      policyRef,
      requiredEvents: detector.requiredEvents,
      windowMs: policy.window_ms,
      maxInputChars: policy.max_input_tokens * CHARS_PER_TOKEN,
      nowMs,
      triggerReason: primary.reason,
    });
    const existing = await db.query.observationWindows.findFirst({
      where: and(
        eq(schema.observationWindows.contentHash, built.contentHash),
        eq(schema.observationWindows.detectorRef, ref),
      ),
    });
    if (existing) {
      results.push({ action: "unchanged_window", detectorId: detector.detectorId });
      continue;
    }
    if (inFlight) {
      results.push({ action: "deferred", reason: "in_flight", detectorId: detector.detectorId });
      continue;
    }
    if (inCooldown) {
      results.push({ action: "deferred", reason: "cooldown", detectorId: detector.detectorId });
      continue;
    }
    const inserted = await db
      .insert(schema.observationWindows)
      .values({
        id: newId("window"),
        tenantId: session.tenantId,
        productId: input.productId,
        observationSessionId: session.id,
        journeyInstanceId: input.journeyInstanceId,
        journeyId,
        buildRef: session.buildRef,
        detectorRef: ref,
        policyRef,
        startMs: built.startMs,
        endMs: built.endMs,
        eventIds: built.eventIds,
        gaps: built.gaps,
        goalSource: built.goalSource,
        coverage: built.coverage,
        priorProgressSummary: built.priorProgressSummary,
        triggerReason: primary.reason,
        contentHash: built.contentHash,
      })
      .onConflictDoNothing()
      .returning();
    const window = inserted[0];
    if (!window) {
      results.push({ action: "unchanged_window", detectorId: detector.detectorId });
      continue;
    }
    const estimatedInputTokens = Math.ceil(
      (JSON.stringify(built.state).length + JSON.stringify(detector.questions).length) /
        CHARS_PER_TOKEN,
    );
    const reserved = await reserveEvaluation({
      productId: input.productId,
      observationSessionId: session.id,
      policy,
      priceMicrosPer1k: env().jev?.priceMicrosPer1k ?? null,
      estimatedInputTokens,
    });
    if (!reserved.ok) {
      await db.insert(schema.jevEvaluations).values({
        id: newId("eval"),
        tenantId: session.tenantId,
        productId: input.productId,
        windowId: window.id,
        detectorRef: ref,
        policyRef,
        requestHash: `${built.contentHash}:${ref}:${policyRef}`,
        requestedModel: env().jev?.model ?? "jev-latest",
        triggerReason: primary.reason,
        status: "deferred",
        statusReason: reserved.reason,
      });
      results.push({
        action: "deferred",
        reason: reserved.reason,
        detectorId: detector.detectorId,
      });
      continue;
    }
    const evaluationId = newId("eval");
    await db.transaction(async (tx) => {
      await tx.insert(schema.jevEvaluations).values({
        id: evaluationId,
        tenantId: session.tenantId,
        productId: input.productId,
        windowId: window.id,
        detectorRef: ref,
        policyRef,
        requestHash: `${built.contentHash}:${ref}:${policyRef}:${env().jev?.model ?? "jev-latest"}`,
        requestedModel: env().jev?.model ?? "jev-latest",
        triggerReason: primary.reason,
        status: "queued",
        statusReason: `reserved:${reserved.reservationId}:${reserved.reservedMicros}`,
      });
      await emitEvent(tx, {
        type: "evaluation.requested",
        tenantId: session.tenantId,
        productId: input.productId,
        correlationId: input.journeyInstanceId,
        idempotencyKey: `${evaluationId}:requested`,
        payload: {
          evaluation_id: evaluationId,
          window_id: window.id,
          detector_ref: ref,
          trigger_reason: primary.reason,
          sampled: primary.reason === "normal_sample",
        },
      });
    });
    await enqueueJob({
      type: "jev.evaluate",
      payload: { evaluationId },
      dedupeKey: `jev.evaluate:${evaluationId}`,
      maxAttempts: 3,
    });
    results.push({ action: "evaluation_queued", detectorId: detector.detectorId, evaluationId });
  }
  return results;
}

/** Meaningful evidence first; a plain journey end with a normal sample still evaluates. */
function pickTrigger(triggers: Trigger[]): Trigger {
  const order = [
    "repeated_failure",
    "help_request",
    "navigation_loop",
    "possible_stall",
    "normal_sample",
    "journey_end",
  ];
  const sorted = [...triggers].sort((a, b) => order.indexOf(a.reason) - order.indexOf(b.reason));
  const first = sorted[0] ?? triggers[0];
  if (!first) throw new Error("pickTrigger called without triggers");
  return first;
}

/** Retrospective journey ends: five minutes without journey events, evaluated as unknown outcome. */
export async function sweepIdleJourneys(now = new Date()): Promise<ScanResult[]> {
  const cutoff = new Date(now.getTime() - 5 * 60_000);
  const idle = await db
    .select({
      journeyInstanceId: schema.observationEvents.journeyInstanceId,
      observationSessionId: schema.observationEvents.observationSessionId,
      last: sql<Date>`max(${schema.observationEvents.receivedAt})`,
    })
    .from(schema.observationEvents)
    .groupBy(
      schema.observationEvents.journeyInstanceId,
      schema.observationEvents.observationSessionId,
    )
    .having(
      sql`max(${schema.observationEvents.receivedAt}) < ${cutoff.toISOString()}::timestamptz and max(${schema.observationEvents.receivedAt}) > ${new Date(now.getTime() - 24 * 60 * 60_000).toISOString()}::timestamptz`,
    );
  const results: ScanResult[] = [];
  for (const j of idle) {
    const ended = await db.query.observationEvents.findFirst({
      where: and(
        eq(schema.observationEvents.journeyInstanceId, j.journeyInstanceId),
        inArray(schema.observationEvents.type, ["completion", "exit"]),
      ),
    });
    const alreadyEnded = await db
      .select({ id: schema.jevEvaluations.id })
      .from(schema.jevEvaluations)
      .innerJoin(
        schema.observationWindows,
        eq(schema.jevEvaluations.windowId, schema.observationWindows.id),
      )
      .where(
        and(
          eq(schema.observationWindows.journeyInstanceId, j.journeyInstanceId),
          eq(schema.jevEvaluations.triggerReason, "journey_end"),
        ),
      )
      .limit(1);
    if (ended || alreadyEnded.length) continue;
    const session = await db.query.observationSessions.findFirst({
      where: eq(schema.observationSessions.id, j.observationSessionId),
    });
    if (!session) continue;
    const last = await db.query.observationEvents.findFirst({
      where: eq(schema.observationEvents.journeyInstanceId, j.journeyInstanceId),
      orderBy: (e, { desc }) => desc(e.sequence),
    });
    const r = await scanJourney({
      journeyInstanceId: j.journeyInstanceId,
      observationSessionId: j.observationSessionId,
      productId: session.productId,
      nowMs: (last?.tMs ?? 0) + 5 * 60_000 + 1,
    });
    results.push(...r);
  }
  return results;
}
