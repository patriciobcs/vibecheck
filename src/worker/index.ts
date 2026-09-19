import os from "node:os";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handleDiscoveryRun, markDiscoveryRunFailed, markDiscoveryRunQueued } from "./handler";

const workerId = `${os.hostname()}:${process.pid}`;
const leaseMs = 5 * 60 * 1000;
const jobPayloadSchema = z.object({ runId: z.string().min(1) });
let shuttingDown = false;

async function claim() {
  return prisma.$transaction(async (tx) => {
    const jobs = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Job"
      WHERE status = 'pending' AND "nextRunAt" <= (NOW() AT TIME ZONE 'UTC')
        AND ("leaseUntil" IS NULL OR "leaseUntil" < (NOW() AT TIME ZONE 'UTC'))
      ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED`;
    const id = jobs[0]?.id;
    if (!id) return null;
    return tx.job.update({
      where: { id },
      data: { status: "running", lockedBy: workerId, leaseUntil: new Date(Date.now() + leaseMs) },
    });
  });
}

async function processJob(job: Awaited<ReturnType<typeof claim>>) {
  if (!job) return false;
  const heartbeat = setInterval(() => {
    void prisma.job.update({
      where: { id: job.id },
      data: { leaseUntil: new Date(Date.now() + leaseMs) },
    });
  }, 60_000);
  try {
    if (job.type !== "discovery.run") throw new Error("unknown_job_type");
    const payload = jobPayloadSchema.parse(job.payload);
    await handleDiscoveryRun(payload.runId);
    await prisma.job.update({ where: { id: job.id }, data: { status: "done", leaseUntil: null } });
  } catch (error) {
    const attempts = job.attempts + 1;
    const payload = jobPayloadSchema.safeParse(job.payload);
    const terminal =
      (error instanceof Error && error.message === "unknown_job_type") ||
      attempts >= job.maxAttempts;
    if (job.type === "discovery.run" && payload.success) {
      if (terminal) {
        await markDiscoveryRunFailed(payload.data.runId, error);
      } else {
        await markDiscoveryRunQueued(payload.data.runId);
      }
    }
    await prisma.job.update({
      where: { id: job.id },
      data: {
        attempts,
        status: terminal ? "failed" : "pending",
        nextRunAt: new Date(Date.now() + 2 ** attempts * 1000),
        lastError: error instanceof Error ? error.message : "job_failed",
        leaseUntil: null,
      },
    });
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
  await prisma.$disconnect();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    shuttingDown = true;
  });
}

void main();
