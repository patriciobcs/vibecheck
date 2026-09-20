import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { ApiError } from "@/lib/api";
import { newId } from "@/lib/ids";
import { cancelJob, retryJob } from "./jobs";

/** Owner-visible operations view: this tenant's jobs and emitted (un)published domain events. */
export async function listOperations(tenantIds: string[], limit = 200) {
  if (tenantIds.length === 0) return { jobs: [], outbox: [] };
  const capped = Math.max(1, Math.min(limit, 200));
  const [jobs, outbox] = await Promise.all([
    db.query.jobs.findMany({
      where: inArray(schema.jobs.tenantId, tenantIds),
      orderBy: desc(schema.jobs.updatedAt),
      limit: capped,
    }),
    db.query.eventOutbox.findMany({
      where: inArray(sql`${schema.eventOutbox.envelope}->>'tenant_id'`, tenantIds),
      orderBy: desc(schema.eventOutbox.createdAt),
      limit: capped,
    }),
  ]);
  return { jobs, outbox };
}

async function jobForTenant(tenantIds: string[], jobId: string) {
  const job = await db.query.jobs.findFirst({
    where: and(eq(schema.jobs.id, jobId), inArray(schema.jobs.tenantId, tenantIds)),
  });
  if (!job) throw new ApiError(404, "not_found");
  return job;
}

async function auditJob(
  input: { tenantId: string | null; actorUserId: string | null },
  action: "job.retry" | "job.cancel",
  jobId: string,
  detail: Record<string, unknown>,
) {
  await db.insert(schema.auditEvents).values({
    id: newId("audit"),
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    action,
    subjectType: "job",
    subjectId: jobId,
    detail,
  });
}

export async function retryJobAudited(input: {
  tenantIds: string[];
  jobId: string;
  actorUserId: string | null;
}) {
  const job = await jobForTenant(input.tenantIds, input.jobId);
  const updated = await retryJob(job.id);
  if (!updated) throw new ApiError(409, "invalid_state", "job is not retryable");
  await auditJob({ tenantId: job.tenantId, actorUserId: input.actorUserId }, "job.retry", job.id, {
    previous_status: job.status,
  });
  return updated;
}

export async function cancelJobAudited(input: {
  tenantIds: string[];
  jobId: string;
  actorUserId: string | null;
}) {
  const job = await jobForTenant(input.tenantIds, input.jobId);
  const updated = await cancelJob(job.id);
  if (!updated) throw new ApiError(409, "invalid_state", "job is not cancellable");
  await auditJob({ tenantId: job.tenantId, actorUserId: input.actorUserId }, "job.cancel", job.id, {
    previous_status: job.status,
  });
  return updated;
}
