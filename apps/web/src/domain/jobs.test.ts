import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/db/client";
import { resetDb } from "@/test/db";
import { completeJob, enqueueJob, failJob, leaseNextJob } from "./jobs";

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

  it("marks a job done", async () => {
    const job = await enqueueJob({ type: "t", payload: {} });
    await leaseNextJob({ workerId: "w", leaseSeconds: 60 });
    await completeJob(job.id);
    expect((await db.query.jobs.findFirst())?.status).toBe("done");
  });
});
