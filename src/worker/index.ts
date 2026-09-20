import os from "node:os";
import { z } from "zod";
import { and, asc, eq, isNull, lte, lt, or } from "drizzle-orm";
import { db } from "@/db";
import {
  analysisRun as analysisRunTable,
  job as jobTable,
  tenant as tenantTable,
} from "@/db/schema";
import { handleDiscoveryRun, markDiscoveryRunFailed, markDiscoveryRunQueued } from "./handler";
import { handleAnalysisRun } from "./analysisHandler";
import { publishFinding } from "@/services/issues";
import { runRepair } from "@/services/repairs";
import { generateSummary } from "@/services/summaries";

const workerId = `${os.hostname()}:${process.pid}`;
const leaseMs = 5 * 60 * 1000;
const discoveryPayloadSchema = z.object({ runId: z.string().min(1) });
const analysisPayloadSchema = z.object({ analysisRunId: z.string().min(1) });
const issuePayloadSchema = z.object({ findingId: z.string().min(1) });
const repairPayloadSchema = z.object({ repairRunId: z.string().min(1) });
const summaryPayloadSchema = z.object({
  studyId: z.string().min(1),
  studyRevision: z.number().int().positive(),
});
type JobPayload =
  | z.infer<typeof discoveryPayloadSchema>
  | z.infer<typeof analysisPayloadSchema>
  | z.infer<typeof issuePayloadSchema>
  | z.infer<typeof repairPayloadSchema>
  | z.infer<typeof summaryPayloadSchema>;
type JobHandler = (payload: JobPayload, tenantId: string) => Promise<void>;
const handlers: Record<string, JobHandler> = {
  "discovery.run": async (payload, tenantId) => {
    const parsed = discoveryPayloadSchema.parse(payload);
    await handleDiscoveryRun(parsed.runId, undefined, tenantId);
  },
  "analysis.run": async (payload, tenantId) => {
    const parsed = analysisPayloadSchema.parse(payload);
    await handleAnalysisRun(parsed.analysisRunId, undefined, tenantId);
  },
  "issue.publish": async (payload, tenantId) => {
    const parsed = issuePayloadSchema.parse(payload);
    await publishFinding(parsed.findingId, undefined, tenantId);
  },
  "repair.run": async (payload, tenantId) => {
    const parsed = repairPayloadSchema.parse(payload);
    await runRepair(parsed.repairRunId, {}, tenantId);
  },
  "summary.generate": async (payload, tenantId) => {
    const parsed = summaryPayloadSchema.parse(payload);
    await generateSummary(tenantId, parsed.studyId, parsed.studyRevision);
  },
};
let shuttingDown = false;

export async function claim() {
  return db.transaction(async (tx) => {
    const now = new Date();
    const [available] = await tx
      .select({ id: jobTable.id })
      .from(jobTable)
      .innerJoin(tenantTable, eq(jobTable.tenantId, tenantTable.id))
      .where(
        and(
          eq(jobTable.status, "pending"),
          isNull(tenantTable.pausedAt),
          lte(jobTable.nextRunAt, now),
          or(isNull(jobTable.leaseUntil), lt(jobTable.leaseUntil, now)),
        ),
      )
      .orderBy(asc(jobTable.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!available) return null;
    const [claimed] = await tx
      .update(jobTable)
      .set({ status: "running", lockedBy: workerId, leaseUntil: new Date(Date.now() + leaseMs) })
      .where(eq(jobTable.id, available.id))
      .returning();
    return claimed;
  });
}

async function processJob(job: Awaited<ReturnType<typeof claim>>) {
  if (!job) return false;
  const heartbeat = setInterval(() => {
    void db
      .update(jobTable)
      .set({ leaseUntil: new Date(Date.now() + leaseMs) })
      .where(eq(jobTable.id, job.id));
  }, 60_000);
  try {
    const handler = handlers[job.type];
    if (!handler) throw new Error("unknown_job_type");
    const payload: JobPayload =
      job.type === "discovery.run"
        ? discoveryPayloadSchema.parse(job.payload)
        : job.type === "analysis.run"
          ? analysisPayloadSchema.parse(job.payload)
          : job.type === "issue.publish"
            ? issuePayloadSchema.parse(job.payload)
            : job.type === "repair.run"
              ? repairPayloadSchema.parse(job.payload)
              : job.type === "summary.generate"
                ? summaryPayloadSchema.parse(job.payload)
                : (() => {
                    throw new Error("unknown_job_type");
                  })();
    await handler(payload, job.tenantId);
    await db
      .update(jobTable)
      .set({ status: "done", leaseUntil: null })
      .where(eq(jobTable.id, job.id));
  } catch (error) {
    const attempts = job.attempts + 1;
    const payload = discoveryPayloadSchema.safeParse(job.payload);
    const terminal =
      (error instanceof Error &&
        (error.message === "unknown_job_type" ||
          (job.type === "summary.generate" &&
            ["study_not_found", "study_plan_not_found"].includes(error.message)))) ||
      attempts >= job.maxAttempts;
    if (job.type === "discovery.run" && payload.success) {
      if (terminal) {
        await markDiscoveryRunFailed(payload.data.runId, error, job.tenantId);
      } else {
        await markDiscoveryRunQueued(payload.data.runId, job.tenantId);
      }
    } else if (job.type === "analysis.run") {
      const analysisPayload = analysisPayloadSchema.safeParse(job.payload);
      if (analysisPayload.success) {
        const [run] = await db
          .select({ id: analysisRunTable.id })
          .from(analysisRunTable)
          .where(eq(analysisRunTable.id, analysisPayload.data.analysisRunId))
          .limit(1);
        if (run && terminal) {
          await db
            .update(analysisRunTable)
            .set({ status: "failed", error: error instanceof Error ? error.message : "job_failed" })
            .where(eq(analysisRunTable.id, run.id));
        } else if (run) {
          await db
            .update(analysisRunTable)
            .set({ status: "queued" })
            .where(eq(analysisRunTable.id, run.id));
        }
      }
    }
    await db
      .update(jobTable)
      .set({
        attempts,
        status: terminal ? "failed" : "pending",
        nextRunAt: new Date(Date.now() + 2 ** attempts * 1000),
        lastError: error instanceof Error ? error.message : "job_failed",
        leaseUntil: null,
      })
      .where(eq(jobTable.id, job.id));
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}

async function main() {
  while (!shuttingDown) {
    if (!(await processJob(await claim())))
      await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await db.$client.end();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    shuttingDown = true;
  });
}

if (process.env.NODE_ENV !== "test") void main();
