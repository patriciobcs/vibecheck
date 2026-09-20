import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/db/client";
import { resetDb } from "@/test/db";
import { seedStudy } from "@/test/fixtures";
import { cancelJob, completeJob, enqueueJob, failJob, leaseNextJob, retryJob } from "./jobs";

beforeEach(resetDb);

describe("job queue", () => {
  it("enqueues once per dedupe key", async () => {
    const a = await enqueueJob({
      type: "archive.fetch",
      payload: { archiveId: "x" },
      dedupeKey: "archive.fetch:x",
    });
    const b = await enqueueJob({
      type: "archive.fetch",
      payload: { archiveId: "x" },
      dedupeKey: "archive.fetch:x",
    });
    expect(a.id).toBe(b.id);
    expect(await db.$count(schema.jobs)).toBe(1);
  });

  it("leases a queued job exclusively and marks it running", async () => {
    await enqueueJob({ type: "t", payload: {} });
    const first = await leaseNextJob({ workerId: "w1", leaseSeconds: 60 });
    const second = await leaseNextJob({ workerId: "w2", leaseSeconds: 60 });
    expect(first?.status).toBe("running");
    expect(second).toBeNull();
  });

  it("re-leases a job whose lease expired", async () => {
    await enqueueJob({ type: "t", payload: {} });
    const first = await leaseNextJob({ workerId: "w1", leaseSeconds: -1 });
    const second = await leaseNextJob({ workerId: "w2", leaseSeconds: 60 });
    expect(first?.id).toBe(second?.id);
    expect(second?.lockedBy).toBe("w2");
  });

  it("schedules a retry with backoff on failure and dead-letters after max attempts", async () => {
    const job = await enqueueJob({ type: "t", payload: {}, maxAttempts: 2 });
    await leaseNextJob({ workerId: "w", leaseSeconds: 60 });
    await failJob(job.id, new Error("boom"));
    let row = await db.query.jobs.findFirst();
    expect(row?.status).toBe("queued");
    expect(row?.attempts).toBe(1);
    expect(row?.nextRunAt.getTime()).toBeGreaterThan(Date.now());

    await db.update(schema.jobs).set({ nextRunAt: new Date(0) });
    await leaseNextJob({ workerId: "w", leaseSeconds: 60 });
    await failJob(job.id, new Error("boom again"));
    row = await db.query.jobs.findFirst();
    expect(row?.status).toBe("dead");
    expect(row?.lastError).toContain("boom again");
  });

  it("commits a job with the transaction that enqueued it, never on its own", async () => {
    await db
      .transaction(async (tx) => {
        await enqueueJob({ type: "t", payload: {} }, tx);
        throw new Error("rollback");
      })
      .catch(() => {});
    expect(await db.$count(schema.jobs)).toBe(0);
  });

  it("counts an expired lease as a failed attempt and dead-letters a job that keeps crashing", async () => {
    await enqueueJob({ type: "t", payload: {}, maxAttempts: 2 });
    const first = await leaseNextJob({ workerId: "w1", leaseSeconds: -1 });
    expect(first?.attempts).toBe(0);
    const second = await leaseNextJob({ workerId: "w2", leaseSeconds: -1 });
    expect(second?.attempts).toBe(1);
    expect(second?.lastError).toMatch(/lease expired/);
    const third = await leaseNextJob({ workerId: "w3", leaseSeconds: 60 });
    expect(third).toBeNull();
    expect((await db.query.jobs.findFirst())?.status).toBe("dead");
  });

  it("leases only the requested job types", async () => {
    await enqueueJob({ type: "a", payload: {} });
    await enqueueJob({ type: "b", payload: {} });
    const onlyB = await leaseNextJob({ workerId: "w", leaseSeconds: 60, types: ["b"] });
    expect(onlyB?.type).toBe("b");
    expect(await leaseNextJob({ workerId: "w", leaseSeconds: 60, types: ["b"] })).toBeNull();
  });

  it("marks a job done", async () => {
    const job = await enqueueJob({ type: "t", payload: {} });
    await leaseNextJob({ workerId: "w", leaseSeconds: 60 });
    await completeJob(job.id);
    expect((await db.query.jobs.findFirst())?.status).toBe("done");
  });
});

describe("pause-aware leasing", () => {
  it("does not lease a paused tenant's job and leases it after resume", async () => {
    const { tenantId } = await seedStudy();
    const job = await enqueueJob({ type: "t", payload: {}, tenantId });
    await db.update(schema.tenants).set({ paused: true }).where(eq(schema.tenants.id, tenantId));
    expect(await leaseNextJob({ workerId: "w", leaseSeconds: 60 })).toBeNull();
    const row = await db.query.jobs.findFirst({ where: eq(schema.jobs.id, job.id) });
    expect(row?.status).toBe("queued");
    expect(row?.attempts).toBe(0);
    await db.update(schema.tenants).set({ paused: false }).where(eq(schema.tenants.id, tenantId));
    expect((await leaseNextJob({ workerId: "w", leaseSeconds: 60 }))?.id).toBe(job.id);
  });

  it("still leases a job with no tenant", async () => {
    await db.update(schema.tenants).set({ paused: true });
    await enqueueJob({ type: "t", payload: {} });
    expect(await leaseNextJob({ workerId: "w", leaseSeconds: 60 })).not.toBeNull();
  });

  it("cancels only queued jobs and retries failed ones", async () => {
    const { tenantId } = await seedStudy();
    const queued = await enqueueJob({ type: "t", payload: {}, tenantId });
    const running = await enqueueJob({ type: "t2", payload: {}, tenantId });
    await db.update(schema.jobs).set({ status: "running" }).where(eq(schema.jobs.id, running.id));
    const failed = await enqueueJob({ type: "t3", payload: {}, tenantId });
    await db.update(schema.jobs).set({ status: "failed" }).where(eq(schema.jobs.id, failed.id));

    expect((await cancelJob(queued.id))?.status).toBe("cancelled");
    expect(await cancelJob(running.id)).toBeNull();
    expect(await cancelJob(failed.id)).toBeNull();
    const retried = await retryJob(failed.id);
    expect(retried?.status).toBe("queued");
    expect(retried?.attempts).toBe(0);
    // A cancelled job is retryable; a running one is not.
    expect((await retryJob(queued.id))?.status).toBe("queued");
    expect(await retryJob(running.id)).toBeNull();
  });
});
