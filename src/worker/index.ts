import os from "node:os";
import { prisma } from "@/lib/prisma";
import { handleDiscoveryRun, markDiscoveryRunFailed } from "./handler";

const workerId = `${os.hostname()}:${process.pid}`;
const leaseMs = 5 * 60 * 1000;

async function claim() {
  return prisma.$transaction(async (tx) => {
    const jobs = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Job"
      WHERE status = 'pending' AND "nextRunAt" <= (NOW() AT TIME ZONE 'UTC')
        AND ("leaseUntil" IS NULL OR "leaseUntil" < (NOW() AT TIME ZONE 'UTC'))
      ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED`;
    const id = jobs[0]?.id;
    if (!id) return null;
    return tx.job.update({ where: { id }, data: { status: "running", lockedBy: workerId, leaseUntil: new Date(Date.now() + leaseMs) } });
  });
}

async function processJob(job: Awaited<ReturnType<typeof claim>>) {
  if (!job) return false;
  const heartbeat = setInterval(() => {
    void prisma.job.update({ where: { id: job.id }, data: { leaseUntil: new Date(Date.now() + leaseMs) } });
  }, 60_000);
  try {
    const payload = job.payload as { runId?: string };
    if (job.type === "discovery.run" && payload.runId) await handleDiscoveryRun(payload.runId);
    await prisma.job.update({ where: { id: job.id }, data: { status: "done", leaseUntil: null } });
  } catch (error) {
    const attempts = job.attempts + 1;
    const payload = job.payload as { runId?: string };
    if (job.type === "discovery.run" && payload.runId) {
      await markDiscoveryRunFailed(payload.runId, error);
    }
    await prisma.job.update({ where: { id: job.id }, data: {
      attempts, status: attempts >= job.maxAttempts ? "failed" : "pending",
      nextRunAt: new Date(Date.now() + 2 ** attempts * 1000), lastError: error instanceof Error ? error.message : "job_failed",
      leaseUntil: null,
    } });
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}

async function main() {
  while (true) {
    if (!(await processJob(await claim()))) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

void main();
