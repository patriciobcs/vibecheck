import {
  fetchArchiveJob,
  reconcileArchiveJob,
  reconcileStaleArchives,
  transcribeAssetJob,
} from "@/domain/archive-pipeline";
import {
  handleDiscoveryRun,
  markDiscoveryRunFailed,
  markDiscoveryRunQueued,
} from "@/domain/discovery";
import { completeJob, failJob, heartbeatJob, leaseNextJob } from "@/domain/jobs";
import { detectorGeneratorFor, generateDetector } from "@/domain/monitoring/detectors";
import { evaluateJob } from "@/domain/monitoring/evaluate";
import {
  retryDeferredEvaluations,
  scanJourney,
  sweepIdleJourneys,
} from "@/domain/monitoring/screening";
import { env } from "@/lib/env";
import { jevClient, mediaClient, sttClient } from "@/providers";
import { storage } from "@/providers/storage";

/** Runs one job payload. Shared by the worker process and the development drain endpoint. */
export async function runJob(type: string, payload: Record<string, unknown>) {
  switch (type) {
    case "archive.fetch": {
      const media = mediaClient();
      if (!media) throw new Error("Vonage is not configured; cannot fetch archive");
      return fetchArchiveJob(payload as { archiveId: string }, { media, storage: storage() });
    }
    case "archive.reconcile": {
      const media = mediaClient();
      if (!media) throw new Error("Vonage is not configured; cannot reconcile archive");
      await reconcileArchiveJob(payload as { archiveId: string; attempt?: number }, { media });
      return;
    }
    case "asset.transcribe": {
      const stt = sttClient();
      if (!stt) throw new Error("SLNG is not configured; cannot transcribe");
      return transcribeAssetJob(payload as { assetId: string }, { storage: storage(), stt });
    }
    case "discovery.run":
      return handleDiscoveryRun((payload as { runId: string }).runId);
    case "monitoring.scan": {
      const p = payload as {
        journeyInstanceId: string;
        observationSessionId: string;
        productId: string;
      };
      await scanJourney(p);
      return;
    }
    case "monitoring.sweep":
      await sweepIdleJourneys();
      await retryDeferredEvaluations();
      await sweepArchives();
      return;
    case "jev.evaluate": {
      const jev = jevClient();
      if (!jev) throw new Error("Jev is not configured; cannot evaluate");
      return evaluateJob(payload as { evaluationId: string }, {
        jev,
        priceMicrosPer1k: env().jev?.priceMicrosPer1k ?? null,
      });
    }
    case "detector.generate": {
      const p = payload as {
        productId: string;
        detectorId: string;
        appBuildRef: string;
        journeyHint: string;
        provider: "fixture" | "devin";
      };
      const res = await generateDetector(p, detectorGeneratorFor(p.provider));
      if (!res.ok) throw new Error(`detector_generation_failed: ${res.problems.join("; ")}`);
      return;
    }
    default:
      throw new Error(`unknown job type ${type}`);
  }
}

/** Provider check for uploaded assets whose callback never came; a no-op without Vonage. */
export async function sweepArchives() {
  const media = mediaClient();
  if (!media) return [];
  return reconcileStaleArchives({ media });
}

/** Reflect a job failure on the domain object it drives (a retryable failure returns a run to `queued`). */
async function onJobFailure(
  job: { type: string; payload: unknown; attempts: number; maxAttempts: number },
  err: unknown,
) {
  if (job.type !== "discovery.run") return;
  const runId = (job.payload as { runId?: string }).runId;
  if (!runId) return;
  const terminal = job.attempts + 1 >= job.maxAttempts;
  if (terminal) await markDiscoveryRunFailed(runId, err);
  else await markDiscoveryRunQueued(runId);
}

/** Leases and runs one job; returns false when nothing was runnable. */
export async function tick(
  workerId: string,
  types?: string[],
): Promise<{ ran: false } | { ran: true; id: string; type: string; ok: boolean; error?: string }> {
  const leaseSeconds = env().WORKER_LEASE_SECONDS;
  const job = await leaseNextJob({ workerId, leaseSeconds, types });
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
    await onJobFailure(job, err);
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

/** Runs runnable jobs (optionally only some types) until the queue is empty or `max` is reached. */
export async function drain(workerId: string, max = 20, types?: string[]) {
  const results = [];
  for (let i = 0; i < max; i += 1) {
    const r = await tick(workerId, types);
    if (!r.ran) break;
    results.push(r);
  }
  return results;
}
