import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/db/client";
import { resetDb } from "@/test/db";
import { seedStudy } from "@/test/fixtures";
import { enqueueJob } from "./jobs";
import { pauseTenant, resumeTenant } from "./tenant-pause";

beforeEach(resetDb);

describe("tenant pause", () => {
  it("pauses, audits, emits once, and resumes", async () => {
    const { tenantId } = await seedStudy();
    await enqueueJob({ type: "t", payload: {}, tenantId });
    const first = await pauseTenant({ tenantId, actorUserId: "user_1", reason: "maintenance" });
    expect(first).toMatchObject({ action: "paused", paused: true });
    const row = await db.query.tenants.findFirst({ where: eq(schema.tenants.id, tenantId) });
    expect(row?.paused).toBe(true);
    expect(row?.pausedAt).not.toBeNull();

    const second = await pauseTenant({ tenantId, actorUserId: "user_1", reason: "again" });
    expect(second.action).toBe("unchanged");

    const audits = await db.query.auditEvents.findMany({
      where: and(eq(schema.auditEvents.tenantId, tenantId)),
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe("tenant.pause");
    expect(audits[0]?.detail).toMatchObject({ reason: "maintenance", affected_queued_jobs: 1 });

    const events = await db.query.eventOutbox.findMany({
      where: eq(schema.eventOutbox.eventType, "tenant.paused"),
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.envelope).toMatchObject({
      tenant_id: tenantId,
      product_id: tenantId,
      correlation_id: tenantId,
    });

    const resumed = await resumeTenant({ tenantId, actorUserId: "user_1" });
    expect(resumed).toMatchObject({ action: "resumed", paused: false, pausedAt: null });
    const after = await db.query.tenants.findFirst({ where: eq(schema.tenants.id, tenantId) });
    expect(after?.paused).toBe(false);
    expect(after?.pausedAt).toBeNull();
    expect(
      await db.query.eventOutbox.findMany({
        where: eq(schema.eventOutbox.eventType, "tenant.resumed"),
      }),
    ).toHaveLength(1);
    expect(await resumeTenant({ tenantId, actorUserId: "user_1" })).toMatchObject({
      action: "unchanged",
    });
  });
});
