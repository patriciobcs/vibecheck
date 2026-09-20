import { and, eq, inArray, lte, or } from "drizzle-orm";
import { type Db, db, schema, type Tx } from "@/db/client";
import { newId } from "@/lib/ids";

export type JobRow = typeof schema.jobs.$inferSelect;

/**
 * Durable job queue on a database table with leases, heartbeats and retries (VC-06).
 * Not a workflow engine: one row per unit of work, business-keyed for idempotency.
 */
export async function enqueueJob(
  input: {
    type: string;
    payload: Record<string, unknown>;
    dedupeKey?: string;
    maxAttempts?: number;
    runAt?: Date;
  },
  /** Pass the surrounding transaction so the job commits (or rolls back) with the data it needs. */
  executor: Db | Tx = db,
): Promise<JobRow> {
  const id = newId("job");
  const [inserted] = await executor
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
  if (inserted) {
    scheduleInlineDrain(inserted.nextRunAt);
    return inserted;
  }
  const existing = await executor.query.jobs.findFirst({
    where: eq(schema.jobs.dedupeKey, input.dedupeKey ?? ""),
  });
  if (!existing) throw new Error("job insert conflict without existing row");
  return existing;
}

/**
 * Serverless deployments have no worker process. With INLINE_JOBS=true, a request that enqueues a
 * job also runs the queue after its response is sent (Next's `after`), waiting out short batch
 * delays. Outside a request (worker, tests) this is a no-op; a cron drain catches stragglers.
 */
function scheduleInlineDrain(runAt: Date) {
  if (process.env.INLINE_JOBS !== "true") return;
  const delay = Math.min(8000, Math.max(0, runAt.getTime() - Date.now()));
  import("next/server")
    .then(({ after }) => {
      after(async () => {
        if (delay > 0) await new Promise((r) => setTimeout(r, delay + 200));
        const { drain } = await import("@/worker/runner");
        await drain("inline", 10);
      });
    })
    .catch(() => {
      /* not inside a request: the cron drain will pick it up */
    });
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
    const typeFilter = input.types?.length ? inArray(schema.jobs.type, input.types) : undefined;
    const [candidate] = await tx
      .select()
      .from(schema.jobs)
      .where(typeFilter ? and(runnable, typeFilter) : runnable)
      .orderBy(schema.jobs.nextRunAt)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) return null;
    // An expired lease means the previous worker died mid-job: that was an attempt, so a job that
    // keeps crashing its worker is dead-lettered instead of looping forever.
    const expired = candidate.status === "running";
    const attempts = expired ? candidate.attempts + 1 : candidate.attempts;
    const lastError = expired
      ? `lease expired while running on ${candidate.lockedBy ?? "unknown worker"}`
      : candidate.lastError;
    if (expired && attempts >= candidate.maxAttempts) {
      await tx
        .update(schema.jobs)
        .set({
          status: "dead",
          attempts,
          lastError,
          leaseExpiresAt: null,
          lockedBy: null,
          updatedAt: now,
        })
        .where(eq(schema.jobs.id, candidate.id));
      return null;
    }
    const [leased] = await tx
      .update(schema.jobs)
      .set({
        status: "running",
        attempts,
        lastError,
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
