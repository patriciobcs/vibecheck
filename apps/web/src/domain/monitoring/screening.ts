import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { env } from "@/lib/env";
import { newId } from "@/lib/ids";
import { emitEvent } from "../events";
import { enqueueJob } from "../jobs";
import { type PriceMicros, reserveEvaluation } from "./budget";
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
const IDLE_JOURNEY_MS = 5 * 60_000;

/** Budget refusals that can clear on their own; a deferred evaluation with one of these is retried. */
const RETRYABLE_BUDGET_REASONS = new Set(["product_day_cap", "session_hour_cap", "spend_cap"]);

type EvaluationRow = typeof schema.jevEvaluations.$inferSelect;
type WindowRow = typeof schema.observationWindows.$inferSelect;
type Policy = Awaited<ReturnType<typeof currentMonitoringPolicy>>["policy"];

/** A journey instance id is client-chosen; it only identifies a journey together with its session. */
const journeyScope = (observationSessionId: string, journeyInstanceId: string) =>
  and(
    eq(schema.observationEvents.observationSessionId, observationSessionId),
    eq(schema.observationEvents.journeyInstanceId, journeyInstanceId),
  );

async function journeyEvents(observationSessionId: string, journeyInstanceId: string) {
  const rows = await db.query.observationEvents.findMany({
    where: journeyScope(observationSessionId, journeyInstanceId),
    orderBy: asc(schema.observationEvents.sequence),
  });
  const events: JourneyEvent[] = rows.map((r) => ({
    id: r.id,
    sequence: r.sequence,
    t_ms: r.tMs,
    type: r.type,
    payload: r.payload as Record<string, unknown>,
  }));
  return { events, journeyId: rows[0]?.journeyId ?? "", rows };
}

function configuredPrice(): PriceMicros {
  return env().jev?.priceMicrosPer1k ?? null;
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
  /** Defaults to the configured Jev price; tests inject one to exercise spend accounting. */
  priceMicrosPer1k?: PriceMicros;
}): Promise<ScanResult[]> {
  const { policy, policyRef } = await currentMonitoringPolicy(input.productId);
  if (!policy.enabled) return [{ action: "skipped", reason: "monitoring_disabled" }];
  const session = await db.query.observationSessions.findFirst({
    where: eq(schema.observationSessions.id, input.observationSessionId),
  });
  if (!session) return [{ action: "skipped", reason: "session_not_found" }];
  if (session.productId !== input.productId)
    return [{ action: "skipped", reason: "session_product_mismatch" }];
  const tenant = await db.query.tenants.findFirst({
    where: eq(schema.tenants.id, session.tenantId),
  });
  if (tenant?.paused) return [{ action: "skipped", reason: "tenant_paused" }];
  const price = input.priceMicrosPer1k === undefined ? configuredPrice() : input.priceMicrosPer1k;

  const { events, journeyId, rows } = await journeyEvents(session.id, input.journeyInstanceId);
  const [firstRow] = rows;
  if (!firstRow) return [{ action: "skipped", reason: "no_events" }];
  const lastReceived = rows.reduce((m, r) => (r.receivedAt > m.receivedAt ? r : m), firstRow);
  // The journey clock: "now" is the last event time plus wall-clock elapsed since it arrived.
  const nowMs =
    input.nowMs ?? lastReceived.tMs + Math.max(0, Date.now() - lastReceived.receivedAt.getTime());

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
    .where(
      and(
        eq(schema.observationWindows.observationSessionId, session.id),
        eq(schema.observationWindows.journeyInstanceId, input.journeyInstanceId),
      ),
    );
  const inFlight = recent.some((r) => r.status === "queued" || r.status === "running");
  const lastAt = recent
    .filter((r) => r.status !== "deferred")
    .reduce((m, r) => Math.max(m, r.requestedAt.getTime()), 0);
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
      // An unchanged window whose evaluation was refused for budget is retried, never forgotten.
      const deferred = await retryableDeferredFor(existing.id);
      results.push(
        deferred
          ? await requeueDeferred(deferred, existing, policy, price)
          : { action: "unchanged_window", detectorId: detector.detectorId },
      );
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
    const requestedModel = env().jev?.model ?? "jev-latest";
    const evaluationId = newId("eval");
    const base = {
      id: evaluationId,
      tenantId: session.tenantId,
      productId: input.productId,
      windowId: window.id,
      detectorRef: ref,
      policyRef,
      requestHash: `${built.contentHash}:${ref}:${policyRef}:${requestedModel}`,
      requestedModel,
      triggerReason: primary.reason,
      estimatedInputTokens,
    };
    const reserved = await reserveEvaluation({
      productId: input.productId,
      observationSessionId: session.id,
      policy,
      priceMicrosPer1k: price,
      estimatedInputTokens,
    });
    if (!reserved.ok) {
      await db
        .insert(schema.jevEvaluations)
        .values({ ...base, status: "deferred", statusReason: reserved.reason });
      results.push({
        action: "deferred",
        reason: reserved.reason,
        detectorId: detector.detectorId,
        evaluationId,
      });
      continue;
    }
    await db.transaction(async (tx) => {
      await tx.insert(schema.jevEvaluations).values({
        ...base,
        status: "queued",
        reservationId: reserved.reservationId,
        reservedMicros: reserved.reservedMicros,
      });
      await announceQueued(tx, { ...base, journeyInstanceId: input.journeyInstanceId });
    });
    results.push({ action: "evaluation_queued", detectorId: detector.detectorId, evaluationId });
  }
  return results;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Emits `evaluation.requested` and enqueues the job in the same transaction as the row change. */
async function announceQueued(
  tx: Tx,
  e: {
    id: string;
    tenantId: string;
    productId: string;
    windowId: string;
    detectorRef: string;
    triggerReason: string;
    journeyInstanceId: string;
  },
) {
  await emitEvent(tx, {
    type: "evaluation.requested",
    tenantId: e.tenantId,
    productId: e.productId,
    correlationId: e.journeyInstanceId,
    idempotencyKey: `${e.id}:requested`,
    payload: {
      evaluation_id: e.id,
      window_id: e.windowId,
      detector_ref: e.detectorRef,
      trigger_reason: e.triggerReason,
      sampled: e.triggerReason === "normal_sample",
    },
  });
  await enqueueJob(
    {
      type: "jev.evaluate",
      payload: { evaluationId: e.id },
      dedupeKey: `jev.evaluate:${e.id}`,
      maxAttempts: 3,
    },
    tx,
  );
}

async function retryableDeferredFor(windowId: string): Promise<EvaluationRow | null> {
  const row = await db.query.jevEvaluations.findFirst({
    where: and(
      eq(schema.jevEvaluations.windowId, windowId),
      eq(schema.jevEvaluations.status, "deferred"),
    ),
  });
  return row && RETRYABLE_BUDGET_REASONS.has(row.statusReason ?? "") ? row : null;
}

/** Tries the reservation again for a deferred evaluation; queues it or records the new refusal. */
async function requeueDeferred(
  evaluation: EvaluationRow,
  window: WindowRow,
  policy: Policy,
  price: PriceMicros,
  now = new Date(),
): Promise<ScanResult> {
  const detectorId = evaluation.detectorRef.split(":")[0];
  const reserved = await reserveEvaluation({
    productId: evaluation.productId,
    observationSessionId: window.observationSessionId,
    policy,
    priceMicrosPer1k: price,
    estimatedInputTokens: evaluation.estimatedInputTokens,
    now,
  });
  if (!reserved.ok) {
    await db
      .update(schema.jevEvaluations)
      .set({ statusReason: reserved.reason })
      .where(eq(schema.jevEvaluations.id, evaluation.id));
    return { action: "deferred", reason: reserved.reason, detectorId, evaluationId: evaluation.id };
  }
  await db.transaction(async (tx) => {
    await tx
      .update(schema.jevEvaluations)
      .set({
        status: "queued",
        statusReason: null,
        reservationId: reserved.reservationId,
        reservedMicros: reserved.reservedMicros,
        requestedAt: now,
      })
      .where(eq(schema.jevEvaluations.id, evaluation.id));
    await announceQueued(tx, { ...evaluation, journeyInstanceId: window.journeyInstanceId });
  });
  return { action: "evaluation_queued", detectorId, evaluationId: evaluation.id };
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Budget-deferred evaluations are retried once their cap can have cleared: day caps on a new UTC
 * day, the session-hour cap an hour later. Runs with the sweep; a policy that is now off skips them.
 */
export async function retryDeferredEvaluations(now = new Date()): Promise<ScanResult[]> {
  const deferred = await db.query.jevEvaluations.findMany({
    where: and(
      eq(schema.jevEvaluations.status, "deferred"),
      inArray(schema.jevEvaluations.statusReason, [...RETRYABLE_BUDGET_REASONS]),
    ),
    orderBy: asc(schema.jevEvaluations.requestedAt),
  });
  const results: ScanResult[] = [];
  for (const e of deferred) {
    const eligible =
      e.statusReason === "session_hour_cap"
        ? now.getTime() - e.requestedAt.getTime() >= 60 * 60_000
        : utcDay(e.requestedAt) !== utcDay(now);
    if (!eligible) continue;
    const window = await db.query.observationWindows.findFirst({
      where: eq(schema.observationWindows.id, e.windowId),
    });
    if (!window) continue;
    const { policy } = await currentMonitoringPolicy(e.productId);
    if (!policy.enabled) continue;
    results.push(await requeueDeferred(e, window, policy, configuredPrice(), now));
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
  const cutoff = new Date(now.getTime() - IDLE_JOURNEY_MS);
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
    const scope = journeyScope(j.observationSessionId, j.journeyInstanceId);
    const ended = await db.query.observationEvents.findFirst({
      where: and(scope, inArray(schema.observationEvents.type, ["completion", "exit"])),
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
          eq(schema.observationWindows.observationSessionId, j.observationSessionId),
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
      where: scope,
      orderBy: desc(schema.observationEvents.sequence),
    });
    const r = await scanJourney({
      journeyInstanceId: j.journeyInstanceId,
      observationSessionId: j.observationSessionId,
      productId: session.productId,
      nowMs: (last?.tMs ?? 0) + IDLE_JOURNEY_MS + 1,
    });
    results.push(...r);
  }
  return results;
}
