import os from "node:os";
import { z } from "zod";
import { and, asc, eq, isNull, lte, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { job as jobTable } from "@/db/schema";
import { handleDiscoveryRun, markDiscoveryRunFailed, markDiscoveryRunQueued } from "./handler";

const workerId = `${os.hostname()}:${process.pid}`;
const leaseMs = 5 * 60 * 1000;
const jobPayloadSchema = z.object({ runId: z.string().min(1) });
let shuttingDown = false;

async function claim() {
  return db.transaction(async (tx) => {
    const now = new Date();
    const [available] = await tx
      .select({ id: jobTable.id })
      .from(jobTable)
      .where(
        and(
          eq(jobTable.status, "pending"),
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
    if (job.type !== "discovery.run") throw new Error("unknown_job_type");
    const payload = jobPayloadSchema.parse(job.payload);
    await handleDiscoveryRun(payload.runId, undefined, job.tenantId);
    await db
      .update(jobTable)
      .set({ status: "done", leaseUntil: null })
      .where(eq(jobTable.id, job.id));
  } catch (error) {
    const attempts = job.attempts + 1;
    const payload = jobPayloadSchema.safeParse(job.payload);
    const terminal =
      (error instanceof Error && error.message === "unknown_job_type") ||
      attempts >= job.maxAttempts;
    if (job.type === "discovery.run" && payload.success) {
      if (terminal) {
        await markDiscoveryRunFailed(payload.data.runId, error, job.tenantId);
      } else {
        await markDiscoveryRunQueued(payload.data.runId, job.tenantId);
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

void main();
