import { ObservationBatchSchema } from "@vibecheck/contracts";
import { and, eq, max } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { newId } from "@/lib/ids";
import { emitEvent } from "../events";
import { enqueueJob } from "../jobs";
import { currentMonitoringPolicy } from "./policy";

export type OpenResult =
  | { ok: true; sessionId: string; productId: string; policyRef: string; batchDelayMs: number }
  | {
      ok: false;
      reason:
        | "unknown_key"
        | "origin_not_permitted"
        | "monitoring_disabled"
        | "permission_not_granted";
    };

/**
 * Opens a pseudonymous observation session. Passive collection has its own permission state,
 * reported by the host; installing the SDK or consenting to a study grants nothing here.
 */
export async function openObservationSession(input: {
  publishableKey: string;
  origin: string;
  buildRef: string;
  collectionPermission: "granted" | "denied" | "unknown";
  instrumentationSchemaVersion?: string;
}): Promise<OpenResult> {
  const product = await db.query.products.findFirst({
    where: eq(schema.products.publishableKey, input.publishableKey),
  });
  if (!product) return { ok: false, reason: "unknown_key" };
  if (!product.permittedOrigins.includes(input.origin))
    return { ok: false, reason: "origin_not_permitted" };
  const { policy, policyRef } = await currentMonitoringPolicy(product.id);
  if (!policy.enabled) return { ok: false, reason: "monitoring_disabled" };
  if (input.collectionPermission !== "granted")
    return { ok: false, reason: "permission_not_granted" };
  const id = newId("obs");
  await db.insert(schema.observationSessions).values({
    id,
    tenantId: product.tenantId,
    productId: product.id,
    buildRef: input.buildRef,
    instrumentationSchemaVersion: input.instrumentationSchemaVersion ?? "1.0",
    collectionPolicyRef: policyRef,
  });
  return {
    ok: true,
    sessionId: id,
    productId: product.id,
    policyRef,
    batchDelayMs: policy.batch_delay_ms,
  };
}

export type IngestResult =
  | {
      ok: true;
      stored: number;
      ignored: number;
      duplicate: boolean;
      gaps: { after_sequence: number; missing: number }[];
    }
  | {
      ok: false;
      reason: "invalid" | "not_found" | "session_mismatch" | "collection_disabled";
      issues?: string[];
    };

/**
 * Stores allowlisted semantic events once (batch receipt + per-sequence uniqueness), records
 * sequence gaps and receive time, filters journeys the policy does not allow, and schedules a
 * deterministic scan after the batch delay. Never evaluates anything itself.
 */
export async function ingestObservationBatch(input: {
  sessionId: string;
  batch: unknown;
}): Promise<IngestResult> {
  const parsed = ObservationBatchSchema.safeParse(input.batch);
  if (!parsed.success)
    return {
      ok: false,
      reason: "invalid",
      issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  const batch = parsed.data;
  if (batch.observation_session_id !== input.sessionId)
    return { ok: false, reason: "session_mismatch" };
  const session = await db.query.observationSessions.findFirst({
    where: eq(schema.observationSessions.id, input.sessionId),
  });
  if (!session) return { ok: false, reason: "not_found" };
  const { policy } = await currentMonitoringPolicy(session.productId);
  if (!policy.enabled) return { ok: false, reason: "collection_disabled" };
  if (session.suppressedUntil && session.suppressedUntil.getTime() > Date.now())
    return { ok: true, stored: 0, ignored: batch.events.length, duplicate: false, gaps: [] };

  return db.transaction(async (tx) => {
    const receipt = await tx
      .insert(schema.webhookReceipts)
      .values({
        id: newId("obatch"),
        provider: "observation",
        dedupeKey: `${session.id}:${batch.batch_id}`,
        body: { count: batch.events.length },
      })
      .onConflictDoNothing()
      .returning({ id: schema.webhookReceipts.id });
    if (receipt.length === 0) return { ok: true, stored: 0, ignored: 0, duplicate: true, gaps: [] };

    const allowed = batch.events.filter(
      (e) =>
        e.observation_session_id === session.id &&
        (policy.allowed_journeys.length === 0 || policy.allowed_journeys.includes(e.journey_id)),
    );
    const ignored = batch.events.length - allowed.length;
    if (allowed.length === 0) return { ok: true, stored: 0, ignored, duplicate: false, gaps: [] };

    const [{ maxSeq }] = await tx
      .select({ maxSeq: max(schema.observationEvents.sequence) })
      .from(schema.observationEvents)
      .where(eq(schema.observationEvents.observationSessionId, session.id));
    const sorted = [...allowed].sort((a, b) => a.sequence - b.sequence);
    const gaps: { after_sequence: number; missing: number }[] = [];
    let prev = maxSeq ?? -1;
    for (const e of sorted) {
      if (e.sequence - prev > 1 && prev >= 0)
        gaps.push({ after_sequence: prev, missing: e.sequence - prev - 1 });
      prev = Math.max(prev, e.sequence);
    }
    const inserted = await tx
      .insert(schema.observationEvents)
      .values(
        sorted.map((e) => {
          const {
            event_id,
            observation_session_id: _s,
            journey_instance_id,
            journey_id,
            sequence,
            t_ms,
            type,
            ...payload
          } = e;
          return {
            id: newId("oevent"),
            eventId: event_id,
            tenantId: session.tenantId,
            observationSessionId: session.id,
            journeyInstanceId: journey_instance_id,
            journeyId: journey_id,
            sequence,
            tMs: t_ms,
            type,
            payload,
          };
        }),
      )
      .onConflictDoNothing()
      .returning({ id: schema.observationEvents.id });
    await tx
      .update(schema.observationSessions)
      .set({ lastEventAt: new Date() })
      .where(eq(schema.observationSessions.id, session.id));

    await emitEvent(tx, {
      type: "observation.batch_received",
      tenantId: session.tenantId,
      productId: session.productId,
      correlationId: session.id,
      idempotencyKey: `${session.id}:${batch.batch_id}:received`,
      payload: {
        observation_session_id: session.id,
        batch_id: batch.batch_id,
        stored: inserted.length,
        ignored,
        gaps,
      },
    });

    // Batch for `batch_delay_ms`, then one deterministic scan per (session, journey instance) per
    // delay bucket. Journey instance ids are client-chosen, so they only mean something per session.
    const delay = policy.batch_delay_ms;
    const bucket = Math.floor(Date.now() / Math.max(1000, delay));
    for (const journeyInstanceId of new Set(sorted.map((e) => e.journey_instance_id))) {
      await enqueueJob(
        {
          type: "monitoring.scan",
          tenantId: session.tenantId,
          payload: {
            journeyInstanceId,
            observationSessionId: session.id,
            productId: session.productId,
          },
          dedupeKey: `monitoring.scan:${session.id}:${journeyInstanceId}:${bucket}`,
          runAt: new Date(Date.now() + delay),
          maxAttempts: 3,
        },
        tx,
      );
    }
    return { ok: true, stored: inserted.length, ignored, duplicate: false, gaps };
  });
}

/** Suppress passive collection for a session while a research assignment is active. */
export async function suppressObservationSession(sessionId: string, until: Date) {
  await db
    .update(schema.observationSessions)
    .set({ suppressedUntil: until })
    .where(and(eq(schema.observationSessions.id, sessionId)));
}
