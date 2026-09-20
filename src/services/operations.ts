import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEvent, job, outboxEvent } from "@/db/schema";

type JobFilter = {
  status?: "pending" | "running" | "done" | "failed" | "cancelled";
  limit?: number;
};

export async function listJobs(tenantId: string, filter: JobFilter = {}) {
  const conditions = [eq(job.tenantId, tenantId)];
  if (filter.status) conditions.push(eq(job.status, filter.status));
  return db
    .select()
    .from(job)
    .where(and(...conditions))
    .orderBy(desc(job.createdAt))
    .limit(Math.max(1, Math.min(filter.limit ?? 100, 100)));
}

export async function listOutbox(tenantId: string, limit = 100) {
  return db
    .select()
    .from(outboxEvent)
    .where(eq(outboxEvent.tenantId, tenantId))
    .orderBy(desc(outboxEvent.createdAt))
    .limit(Math.max(1, Math.min(limit, 100)));
}

async function auditJob(tenantId: string, action: "job.retry" | "job.cancel", jobId: string) {
  await db.insert(auditEvent).values({
    tenantId,
    actor: "api_key",
    action,
    targetType: "job",
    targetId: jobId,
    details: {},
  });
}

export async function retryJob(tenantId: string, jobId: string) {
  const [row] = await db
    .select()
    .from(job)
    .where(and(eq(job.id, jobId), eq(job.tenantId, tenantId)))
    .limit(1);
  if (!row) return { ok: false as const, reason: "not_found" };
  if (row.status !== "failed") return { ok: false as const, reason: "invalid_state" };
  await db
    .update(job)
    .set({ status: "pending", nextRunAt: new Date(), leaseUntil: null, lastError: null })
    .where(eq(job.id, jobId));
  await auditJob(tenantId, "job.retry", jobId);
  return { ok: true as const };
}

export async function cancelJob(tenantId: string, jobId: string) {
  const [row] = await db
    .select()
    .from(job)
    .where(and(eq(job.id, jobId), eq(job.tenantId, tenantId)))
    .limit(1);
  if (!row) return { ok: false as const, reason: "not_found" };
  if (row.status !== "pending") return { ok: false as const, reason: "invalid_state" };
  await db.update(job).set({ status: "cancelled" }).where(eq(job.id, jobId));
  await auditJob(tenantId, "job.cancel", jobId);
  return { ok: true as const };
}
