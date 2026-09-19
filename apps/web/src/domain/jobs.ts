import { and, eq, lte, or, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { newId } from "@/lib/ids";

export type JobRow = typeof schema.jobs.$inferSelect;

/**
 * Durable job queue on a database table with leases, heartbeats and retries (VC-06).
 * Not a workflow engine: one row per unit of work, business-keyed for idempotency.
 */
export async function enqueueJob(input: {
  type: string;
  payload: Record<string, unknown>;
  dedupeKey?: string;
  maxAttempts?: number;
  runAt?: Date;
}): Promise<JobRow> {
  const id = newId("job");
  const [inserted] = await db
    .insert(schema.jobs)
    .values({
      id,
      type: input.type,
      payload: input.payload,
      dedupeKey: input.dedupeKey ?? null,
      maxAttempts: input.maxAttempts ?? 5,
      nextRunAt: input.runAt ?? new Date(),
    })
    .onConflictDoNothing({ target: schema.jobs.dedupeKey })
    .returning();
  if (inserted) return inserted;
  const existing = await db.query.jobs.findFirst({
    where: eq(schema.jobs.dedupeKey, input.dedupeKey ?? ""),
  });
  if (!existing) throw new Error("job insert conflict without existing row");
  return existing;
}

/** Atomically leases the next runnable job (queued and due, or running with an expired lease). */
export async function leaseNextJob(input: {
  workerId: string;
  leaseSeconds: number;
  types?: string[];
}): Promise<JobRow | null> {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + input.leaseSeconds * 1000);
  return db.transaction(async (tx) => {
    const runnable = or(
      and(eq(schema.jobs.status, "queued"), lte(schema.jobs.nextRunAt, now)),
      and(eq(schema.jobs.status, "running"), lte(schema.jobs.leaseExpiresAt, now)),
    );
    const typeFilter = input.types?.length
      ? sql`${schema.jobs.type} = ANY(${input.types})`
      : undefined;
    const [candidate] = await tx
      .select({ id: schema.jobs.id })
      .from(schema.jobs)
      .where(typeFilter ? and(runnable, typeFilter) : runnable)
      .orderBy(schema.jobs.nextRunAt)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) return null;
    const [leased] = await tx
      .update(schema.jobs)
      .set({
        status: "running",
        lockedBy: input.workerId,
        leaseExpiresAt: leaseUntil,
        updatedAt: now,
      })
      .where(eq(schema.jobs.id, candidate.id))
      .returning();
    return leased ?? null;
  });
}

export async function heartbeatJob(id: string, leaseSeconds: number) {
  await db
    .update(schema.jobs)
    .set({ leaseExpiresAt: new Date(Date.now() + leaseSeconds * 1000), updatedAt: new Date() })
    .where(eq(schema.jobs.id, id));
}

export async function completeJob(id: string) {
  await db
    .update(schema.jobs)
    .set({ status: "done", leaseExpiresAt: null, lockedBy: null, updatedAt: new Date() })
    .where(eq(schema.jobs.id, id));
}

/** Exponential backoff: 5s, 25s, 125s… capped at 30 minutes. */
export function backoffMs(attempt: number): number {
  return Math.min(5000 * 5 ** Math.max(0, attempt - 1), 30 * 60 * 1000);
}

export async function failJob(id: string, err: unknown) {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const row = await db.query.jobs.findFirst({ where: eq(schema.jobs.id, id) });
  if (!row) return;
  const attempts = row.attempts + 1;
  const dead = attempts >= row.maxAttempts;
  await db
    .update(schema.jobs)
    .set({
      status: dead ? "dead" : "queued",
      attempts,
      lastError: message.slice(0, 4000),
      nextRunAt: new Date(Date.now() + backoffMs(attempts)),
      leaseExpiresAt: null,
      lockedBy: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.jobs.id, id));
}

/** Requeue a failed/dead job explicitly (owner-visible retry, VC-06). */
export async function retryJob(id: string) {
  await db
    .update(schema.jobs)
    .set({
      status: "queued",
      nextRunAt: new Date(),
      attempts: 0,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.jobs.id, id));
}
