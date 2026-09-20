import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEvent, outboxEvent, tenant } from "@/db/schema";

export async function pauseTenant(tenantId: string, reason: string | null = null) {
  const [current] = await db.select().from(tenant).where(eq(tenant.id, tenantId)).limit(1);
  if (!current) throw new Error("tenant_not_found");
  if (current.pausedAt) return { action: "unchanged" as const, pausedAt: current.pausedAt };
  const pausedAt = new Date();
  await db.transaction(async (tx) => {
    await tx.update(tenant).set({ pausedAt }).where(eq(tenant.id, tenantId));
    await tx.insert(auditEvent).values({
      tenantId,
      actor: "api_key",
      action: "tenant.pause",
      targetType: "tenant",
      targetId: tenantId,
      details: { reason },
    });
    await tx.insert(outboxEvent).values({
      eventId: randomUUID(),
      eventType: "tenant.paused",
      idempotencyKey: `${tenantId}:tenant.paused:${pausedAt.toISOString()}`,
      tenantId,
      productId: tenantId,
      correlationId: tenantId,
      payload: { tenant_id: tenantId, actor: "api_key", reason },
      occurredAt: pausedAt,
    });
  });
  return { action: "paused" as const, pausedAt };
}

export async function resumeTenant(tenantId: string) {
  const [current] = await db.select().from(tenant).where(eq(tenant.id, tenantId)).limit(1);
  if (!current) throw new Error("tenant_not_found");
  if (!current.pausedAt) return { action: "unchanged" as const, pausedAt: null };
  const resumedAt = new Date();
  await db.transaction(async (tx) => {
    await tx.update(tenant).set({ pausedAt: null }).where(eq(tenant.id, tenantId));
    await tx.insert(auditEvent).values({
      tenantId,
      actor: "api_key",
      action: "tenant.resume",
      targetType: "tenant",
      targetId: tenantId,
      details: {},
    });
    await tx.insert(outboxEvent).values({
      eventId: randomUUID(),
      eventType: "tenant.resumed",
      idempotencyKey: `${tenantId}:tenant.resumed:${resumedAt.toISOString()}`,
      tenantId,
      productId: tenantId,
      correlationId: tenantId,
      payload: { tenant_id: tenantId, actor: "api_key", reason: null },
      occurredAt: resumedAt,
    });
  });
  return { action: "resumed" as const, pausedAt: null };
}

export async function isPaused(tenantId: string) {
  const [current] = await db
    .select({ pausedAt: tenant.pausedAt })
    .from(tenant)
    .where(eq(tenant.id, tenantId))
    .limit(1);
  return current?.pausedAt ?? null;
}
