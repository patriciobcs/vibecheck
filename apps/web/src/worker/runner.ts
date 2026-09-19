import { fetchArchiveJob, transcribeAssetJob } from "@/domain/archive-pipeline";
import { completeJob, failJob, heartbeatJob, leaseNextJob } from "@/domain/jobs";
import { env } from "@/lib/env";
import { mediaClient, sttClient } from "@/providers";
import { storage } from "@/providers/storage";

/** Runs one job payload. Shared by the worker process and the development drain endpoint. */
export async function runJob(type: string, payload: Record<string, unknown>) {
  switch (type) {
    case "archive.fetch": {
      const media = mediaClient();
      if (!media) throw new Error("Vonage is not configured; cannot fetch archive");
      return fetchArchiveJob(payload as { archiveId: string }, { media, storage: storage() });
    }
    case "asset.transcribe": {
      const stt = sttClient();
      if (!stt) throw new Error("SLNG is not configured; cannot transcribe");
      return transcribeAssetJob(payload as { assetId: string }, { storage: storage(), stt });
    }
    default:
      throw new Error(`unknown job type ${type}`);
  }
}

/** Leases and runs one job; returns false when nothing was runnable. */
export async function tick(
  workerId: string,
): Promise<{ ran: false } | { ran: true; id: string; type: string; ok: boolean; error?: string }> {
  const leaseSeconds = env().WORKER_LEASE_SECONDS;
  const job = await leaseNextJob({ workerId, leaseSeconds });
  if (!job) return { ran: false };
  const heartbeat = setInterval(
    () => void heartbeatJob(job.id, leaseSeconds),
    (leaseSeconds * 1000) / 3,
  );
  try {
    await runJob(job.type, job.payload as Record<string, unknown>);
    await completeJob(job.id);
    return { ran: true, id: job.id, type: job.type, ok: true };
  } catch (err) {
    await failJob(job.id, err);
    return {
      ran: true,
      id: job.id,
      type: job.type,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearInterval(heartbeat);
  }
}

/** Runs runnable jobs until the queue is empty or `max` is reached. */
export async function drain(workerId: string, max = 20) {
  const results = [];
  for (let i = 0; i < max; i += 1) {
    const r = await tick(workerId);
    if (!r.ran) break;
    results.push(r);
  }
  return results;
}
