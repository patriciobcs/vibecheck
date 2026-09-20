import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEvent, job, tenant } from "@/db/schema";
import { cancelJob, retryJob } from "./operations";
import { pauseTenant } from "./settings";
import { claim } from "@/worker";

describe.skipIf(!process.env.DATABASE_URL)("operations", () => {
  it("pauses idempotently and audits once", async () => {
    const [row] = await db.insert(tenant).values({ name: randomUUID() }).returning();
    expect(await pauseTenant(row.id, "maintenance")).toMatchObject({ action: "paused" });
    expect(await pauseTenant(row.id, "maintenance")).toMatchObject({ action: "unchanged" });
    const audits = await db
      .select()
      .from(auditEvent)
      .where(and(eq(auditEvent.tenantId, row.id), eq(auditEvent.action, "tenant.pause")));
    expect(audits).toHaveLength(1);
    await db.delete(tenant).where(eq(tenant.id, row.id));
  });

  it("retries only failed jobs and cancels only pending jobs", async () => {
    const [row] = await db.insert(tenant).values({ name: randomUUID() }).returning();
    const payload = {};
    const [failed] = await db
      .insert(job)
      .values({ tenantId: row.id, type: "test.failed", status: "failed", payload })
      .returning();
    const [pending] = await db
      .insert(job)
      .values({ tenantId: row.id, type: "test.pending", payload })
      .returning();
    const [done] = await db
      .insert(job)
      .values({ tenantId: row.id, type: "test.done", status: "done", payload })
      .returning();
    expect(await retryJob(row.id, failed.id)).toEqual({ ok: true });
    expect(await retryJob(row.id, done.id)).toEqual({ ok: false, reason: "invalid_state" });
    expect(await cancelJob(row.id, pending.id)).toEqual({ ok: true });
    expect(await cancelJob(row.id, done.id)).toEqual({ ok: false, reason: "invalid_state" });
    await db.delete(tenant).where(eq(tenant.id, row.id));
  });

  it("does not claim jobs for paused tenants or cancelled jobs", async () => {
    const [paused] = await db
      .insert(tenant)
      .values({ name: randomUUID(), pausedAt: new Date() })
      .returning();
    const [active] = await db.insert(tenant).values({ name: randomUUID() }).returning();
    await db.insert(job).values({ tenantId: paused.id, type: "paused.job", payload: {} });
    await db
      .insert(job)
      .values({ tenantId: active.id, type: "cancelled.job", status: "cancelled", payload: {} });
    const claimed = await claim();
    expect(claimed).toBeNull();
    await db.delete(tenant).where(eq(tenant.id, paused.id));
    expect(await claim()).toBeNull();
    await db.delete(tenant).where(eq(tenant.id, active.id));
  });
});
