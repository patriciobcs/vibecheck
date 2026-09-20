import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
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
    /** Owning tenant; defaults to a `tenantId` string on the payload. Null = tenant-agnostic. */
    tenantId?: string | null;
    dedupeKey?: string;
    maxAttempts?: number;
    runAt?: Date;
  },
  /** Pass the surrounding transaction so the job commits (or rolls back) with the data it needs. */
  executor: Db | Tx = db,
): Promise<JobRow> {
  const id = newId("job");
  const tenantId =
    input.tenantId ?? (typeof input.payload.tenantId === "string" ? input.payload.tenantId : null);
  const [inserted] = await executor
    .insert(schema.jobs)
    .values({
      id,
      tenantId,
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

/** How long an inline drain keeps following the queue after its request (must fit the function limit). */
const INLINE_DRAIN_BUDGET_MS = 50_000;
/** A queued job due within this horizon is waited for; anything later is left to the next request or cron. */
const INLINE_DRAIN_HORIZON_MS = 10_000;

/**
 * Serverless deployments have no worker process. With INLINE_JOBS=true, a request that enqueues a
 * job also runs the queue after its response is sent (Next's `after`), waiting out short batch
 * delays and following jobs that requeue themselves (archive reconciliation) for a bounded time.
 * Outside a request (worker, tests) this is a no-op; a cron drain catches stragglers.
 */
function scheduleInlineDrain(runAt: Date) {
  if (process.env.INLINE_JOBS !== "true") return;
  const delay = Math.min(INLINE_DRAIN_HORIZON_MS, Math.max(0, runAt.getTime() - Date.now()));
  import("next/server")
    .then(({ after }) => {
      after(() => inlineDrainLoop(delay));
    })
    .catch(() => {
      /* not inside a request: the cron drain will pick it up */
    });
}

/** Any request may nudge the queue (the live board polls while a study finishes). */
export function kickInlineDrain() {
  scheduleInlineDrain(new Date());
}

async function inlineDrainLoop(firstDelayMs: number) {
  const { drain } = await import("@/worker/runner");
  const deadline = Date.now() + INLINE_DRAIN_BUDGET_MS;
  let wait = firstDelayMs;
  while (Date.now() + wait < deadline) {
    if (wait > 0) await new Promise((r) => setTimeout(r, wait + 200));
    await drain("inline", 10);
    const due = await nextDueAt();
    if (!due) return;
    wait = Math.max(0, due.getTime() - Date.now());
    if (wait > INLINE_DRAIN_HORIZON_MS) return;
  }
}

/**
 * When the earliest leasable queued job may run, or null when there is none. A paused tenant's job
 * is skipped for the same reason `leaseNextJob` skips it: waiting for it would never make progress.
 */
export async function nextDueAt(): Promise<Date | null> {
  const [row] = await db
    .select({ nextRunAt: schema.jobs.nextRunAt })
    .from(schema.jobs)
    .leftJoin(schema.tenants, eq(schema.jobs.tenantId, schema.tenants.id))
    .where(
      and(
        eq(schema.jobs.status, "queued"),
        or(isNull(schema.jobs.tenantId), eq(schema.tenants.paused, false)),
      ),
    )
    .orderBy(asc(schema.jobs.nextRunAt))
    .limit(1);
  return row?.nextRunAt ?? null;
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
    // A paused tenant's jobs stay queued (attempts and nextRunAt untouched) until resume.
    const notPaused = or(isNull(schema.jobs.tenantId), eq(schema.tenants.paused, false));
    const [candidate] = await tx
      .select({ job: schema.jobs })
      .from(schema.jobs)
      .leftJoin(schema.tenants, eq(schema.jobs.tenantId, schema.tenants.id))
      .where(typeFilter ? and(runnable, notPaused, typeFilter) : and(runnable, notPaused))
      .orderBy(schema.jobs.nextRunAt)
      .limit(1)
      .for("update", { skipLocked: true, of: schema.jobs });
    if (!candidate) return null;
    const job = candidate.job;
    // An expired lease means the previous worker died mid-job: that was an attempt, so a job that
    // keeps crashing its worker is dead-lettered instead of looping forever.
    const expired = job.status === "running";
    const attempts = expired ? job.attempts + 1 : job.attempts;
    const lastError = expired
      ? `lease expired while running on ${job.lockedBy ?? "unknown worker"}`
      : job.lastError;
    if (expired && attempts >= job.maxAttempts) {
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
        .where(eq(schema.jobs.id, job.id));
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
      .where(eq(schema.jobs.id, job.id))
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

/** Requeue a failed/dead/cancelled job explicitly (owner-visible retry, VC-06). */
export async function retryJob(id: string): Promise<JobRow | null> {
  const [row] = await db
    .update(schema.jobs)
    .set({
      status: "queued",
      nextRunAt: new Date(),
      attempts: 0,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(
      and(eq(schema.jobs.id, id), inArray(schema.jobs.status, ["failed", "dead", "cancelled"])),
    )
    .returning();
  return row ?? null;
}

/** Cancel a job that has not started; running work is left to finish (VC-06). */
export async function cancelJob(id: string): Promise<JobRow | null> {
  const [row] = await db
    .update(schema.jobs)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(schema.jobs.id, id), eq(schema.jobs.status, "queued")))
    .returning();
  return row ?? null;
}
