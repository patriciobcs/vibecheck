import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { ApiError } from "@/lib/api";
import { newId } from "@/lib/ids";
import { emitEvent } from "./events";

export type PauseResult = {
  action: "paused" | "resumed" | "unchanged";
  paused: boolean;
  pausedAt: Date | null;
};

/**
 * Tenant-level global pause (VC-06): `tenants.paused` is the source of truth checked by the
 * worker before leasing a job; `pausedAt` records when it took effect for display and audit.
 * Tenant-level events carry the tenant id in `product_id` because the envelope requires one.
 */
export async function pauseTenant(input: {
  tenantId: string;
  actorUserId: string | null;
  reason: string | null;
}): Promise<PauseResult> {
  const current = await db.query.tenants.findFirst({
    where: eq(schema.tenants.id, input.tenantId),
  });
  if (!current) throw new ApiError(404, "not_found");
  if (current.paused) return { action: "unchanged", paused: true, pausedAt: current.pausedAt };
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.tenants)
      .set({ paused: true, pausedAt: now })
      .where(eq(schema.tenants.id, input.tenantId));
    const queued = await tx.query.jobs.findMany({
      where: and(eq(schema.jobs.tenantId, input.tenantId), eq(schema.jobs.status, "queued")),
      columns: { id: true },
    });
    await tx.insert(schema.auditEvents).values({
      id: newId("audit"),
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "tenant.pause",
      subjectType: "tenant",
      subjectId: input.tenantId,
      detail: { reason: input.reason, affected_queued_jobs: queued.length },
    });
    await emitEvent(tx, {
      type: "tenant.paused",
      tenantId: input.tenantId,
      productId: input.tenantId,
      correlationId: input.tenantId,
      idempotencyKey: `${input.tenantId}:tenant.paused:${now.toISOString()}`,
      payload: {
        tenant_id: input.tenantId,
        reason: input.reason,
        affected_queued_jobs: queued.length,
      },
    });
  });
  return { action: "paused", paused: true, pausedAt: now };
}

export async function resumeTenant(input: {
  tenantId: string;
  actorUserId: string | null;
}): Promise<PauseResult> {
  const current = await db.query.tenants.findFirst({
    where: eq(schema.tenants.id, input.tenantId),
  });
  if (!current) throw new ApiError(404, "not_found");
  if (!current.paused) return { action: "unchanged", paused: false, pausedAt: null };
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.tenants)
      .set({ paused: false, pausedAt: null })
      .where(eq(schema.tenants.id, input.tenantId));
    const queued = await tx.query.jobs.findMany({
      where: and(eq(schema.jobs.tenantId, input.tenantId), eq(schema.jobs.status, "queued")),
      columns: { id: true },
    });
    await tx.insert(schema.auditEvents).values({
      id: newId("audit"),
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "tenant.resume",
      subjectType: "tenant",
      subjectId: input.tenantId,
      detail: { reason: null, affected_queued_jobs: queued.length },
    });
    await emitEvent(tx, {
      type: "tenant.resumed",
      tenantId: input.tenantId,
      productId: input.tenantId,
      correlationId: input.tenantId,
      idempotencyKey: `${input.tenantId}:tenant.resumed:${now.toISOString()}`,
      payload: {
        tenant_id: input.tenantId,
        reason: null,
        affected_queued_jobs: queued.length,
      },
    });
  });
  return { action: "resumed", paused: false, pausedAt: null };
}
