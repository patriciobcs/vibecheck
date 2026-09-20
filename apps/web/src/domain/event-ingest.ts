import { ClientEventBatchSchema } from "@vibecheck/contracts";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { newId } from "@/lib/ids";
import { scrubUrl } from "./url-scrub";

export type IngestResult =
  | { ok: true; stored: number; duplicate: boolean }
  | { ok: false; reason: "not_found" | "invalid" | "not_recording"; issues?: string[] };

/**
 * Accepts an SDK event batch: strict schema (no free text), ownership check, batch-level
 * idempotency, per-event unique sequence, URL scrubbing before storage.
 */
export async function ingestEventBatch(input: {
  participantId: string;
  batch: unknown;
}): Promise<IngestResult> {
  const parsed = ClientEventBatchSchema.safeParse(input.batch);
  if (!parsed.success)
    return {
      ok: false,
      reason: "invalid",
      issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  const batch = parsed.data;

  const session = await db.query.sessions.findFirst({
    where: eq(schema.sessions.id, batch.session_id),
  });
  if (!session) return { ok: false, reason: "not_found" };
  const assignment = await db.query.assignments.findFirst({
    where: and(
      eq(schema.assignments.id, session.assignmentId),
      eq(schema.assignments.participantId, input.participantId),
    ),
  });
  if (!assignment) return { ok: false, reason: "not_found" };
  if (assignment.state !== "recording" && assignment.state !== "submitting")
    return { ok: false, reason: "not_recording" };

  return db.transaction(async (tx) => {
    const receipt = await tx
      .insert(schema.eventBatches)
      .values({
        id: newId("batch"),
        sessionId: session.id,
        batchSequence: batch.batch_sequence,
        eventCount: batch.events.length,
      })
      .onConflictDoNothing()
      .returning({ id: schema.eventBatches.id });
    if (receipt.length === 0) return { ok: true, stored: 0, duplicate: true };

    if (batch.events.length === 0) return { ok: true, stored: 0, duplicate: false };
    const rows = batch.events.map((ev) => {
      const { session_id: _sid, sequence, t_ms, type, ...rest } = ev;
      const payload = { ...rest, ...(rest.path ? { path: scrubUrl(rest.path) } : {}) };
      return {
        id: newId("ev"),
        tenantId: session.tenantId,
        sessionId: session.id,
        sequence,
        tMs: t_ms,
        type,
        payload,
      };
    });
    const inserted = await tx
      .insert(schema.sessionEvents)
      .values(rows)
      .onConflictDoNothing()
      .returning({ id: schema.sessionEvents.id });
    return { ok: true, stored: inserted.length, duplicate: false };
  });
}
