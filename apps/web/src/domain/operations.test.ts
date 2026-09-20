import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/db/client";
import { ApiError } from "@/lib/api";
import { resetDb } from "@/test/db";
import { seedStudy } from "@/test/fixtures";
import { enqueueJob } from "./jobs";
import { cancelJobAudited, listOperations, retryJobAudited } from "./operations";

beforeEach(resetDb);

describe("operations", () => {
  it("retries a failed job and audits it", async () => {
    const { tenantId } = await seedStudy();
    const job = await enqueueJob({ type: "t", payload: {}, tenantId });
    await db.update(schema.jobs).set({ status: "failed" }).where(eq(schema.jobs.id, job.id));
    const retried = await retryJobAudited({
      tenantIds: [tenantId],
      jobId: job.id,
      actorUserId: "u",
    });
    expect(retried.status).toBe("queued");
    const audits = await db.query.auditEvents.findMany({
      where: eq(schema.auditEvents.action, "job.retry"),
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.detail).toMatchObject({ previous_status: "failed" });
  });

  it("cancels a queued job and refuses a running one", async () => {
    const { tenantId } = await seedStudy();
    const queued = await enqueueJob({ type: "t", payload: {}, tenantId });
    const cancelled = await cancelJobAudited({
      tenantIds: [tenantId],
      jobId: queued.id,
      actorUserId: null,
    });
    expect(cancelled.status).toBe("cancelled");
    const running = await enqueueJob({ type: "t2", payload: {}, tenantId });
    await db.update(schema.jobs).set({ status: "running" }).where(eq(schema.jobs.id, running.id));
    await expect(
      cancelJobAudited({ tenantIds: [tenantId], jobId: running.id, actorUserId: null }),
    ).rejects.toMatchObject({ status: 409, code: "invalid_state" });
  });

  it("rejects cross-tenant access and lists only own jobs", async () => {
    const { tenantId } = await seedStudy();
    const other = await seedStudy();
    const job = await enqueueJob({ type: "t", payload: {}, tenantId });
    await expect(
      cancelJobAudited({ tenantIds: [other.tenantId], jobId: job.id, actorUserId: null }),
    ).rejects.toThrow(ApiError);
    const ops = await listOperations([tenantId]);
    expect(ops.jobs.map((j) => j.id)).toEqual([job.id]);
    expect(await listOperations([])).toEqual({ jobs: [], outbox: [] });
  });
});
