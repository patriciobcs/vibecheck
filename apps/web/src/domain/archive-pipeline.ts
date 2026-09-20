import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { env } from "@/lib/env";
import { newId } from "@/lib/ids";
import { mapDeepgramResponse, type SttClient } from "@/providers/slng";
import type { StorageClient } from "@/providers/storage";
import type { MediaClient } from "@/providers/vonage";
import { enqueueAnalysisForSession } from "./analyses";
import { emitEvent } from "./events";
import { enqueueJob } from "./jobs";

/* ---------------- Vonage archive status callback ---------------- */

export const ArchiveCallbackSchema = z
  .object({
    id: z.string().min(1),
    event: z.string().optional(),
    status: z.string().min(1),
    sessionId: z.string().optional(),
    url: z.string().optional(),
    duration: z.number().optional(),
    size: z.number().optional(),
    reason: z.string().optional(),
  })
  .passthrough();

export type CallbackResult =
  | { ok: true; duplicate: true }
  | {
      ok: true;
      duplicate: false;
      action: "fetch_enqueued" | "marked_failed" | "status_recorded" | "unknown_archive";
    };

export type CallbackDeps = { enqueue?: typeof enqueueJob };

/**
 * Deduplicates by (archiveId, status), records provider status on the asset and turns
 * "available" into a durable fetch job. Receipt, status and job commit together: if processing
 * fails, the provider's retry is processed instead of being treated as a duplicate.
 * Never trusts the callback URL beyond triggering a fetch.
 */
export async function handleArchiveCallback(
  rawBody: unknown,
  deps: CallbackDeps = {},
): Promise<CallbackResult> {
  const body = ArchiveCallbackSchema.parse(rawBody);
  const enqueue = deps.enqueue ?? enqueueJob;
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.webhookReceipts)
      .values({ id: newId("wh"), provider: "vonage", dedupeKey: `${body.id}:${body.status}`, body })
      .onConflictDoNothing()
      .returning({ id: schema.webhookReceipts.id });
    if (inserted.length === 0) return { ok: true, duplicate: true };

    const asset = await tx.query.assets.findFirst({
      where: eq(schema.assets.providerArchiveId, body.id),
    });
    if (!asset) return { ok: true, duplicate: false, action: "unknown_archive" };

    if (body.status === "failed") {
      await tx
        .update(schema.assets)
        .set({
          status: "failed",
          providerStatus: body.status,
          failureReason: body.reason ?? "provider reported failure",
          updatedAt: new Date(),
        })
        .where(eq(schema.assets.id, asset.id));
      await tx
        .update(schema.sessions)
        .set({ completeness: "incomplete" })
        .where(eq(schema.sessions.id, asset.sessionId));
      return { ok: true, duplicate: false, action: "marked_failed" };
    }

    await tx
      .update(schema.assets)
      .set({ providerStatus: body.status, updatedAt: new Date() })
      .where(eq(schema.assets.id, asset.id));

    if (body.status === "available") {
      await enqueue(
        {
          type: "archive.fetch",
          payload: { archiveId: body.id },
          dedupeKey: `archive.fetch:${body.id}`,
        },
        tx,
      );
      return { ok: true, duplicate: false, action: "fetch_enqueued" };
    }
    return { ok: true, duplicate: false, action: "status_recorded" };
  });
}

/* ---------------- Reconciliation: no webhook required ---------------- */

/** Seconds between provider checks; a short archive is usually available within a few of them. */
export const RECONCILE_DELAY_MS = 6_000;
/** After this many checks the daily sweep takes over. */
export const RECONCILE_MAX_ATTEMPTS = 12;
/** An uploaded asset that heard nothing for this long is reconciled by the sweep. */
export const RECONCILE_GRACE_MS = 30_000;

export type ReconcileDeps = { media: MediaClient; enqueue?: typeof enqueueJob };
export type ReconcileResult =
  | {
      action:
        | "fetch_enqueued"
        | "marked_failed"
        | "unknown_archive"
        | "already_handled"
        | "gave_up";
    }
  | { action: "requeued"; attempt: number };

/**
 * Asks the provider for the archive's status instead of waiting for its callback (serverless
 * deployments cannot rely on one arriving). Shares the fetch job's dedupe key with the callback
 * path, so whichever arrives first wins and the other is a no-op.
 */
export async function reconcileArchive(
  archiveId: string,
  attempt: number,
  deps: ReconcileDeps,
): Promise<ReconcileResult> {
  const enqueue = deps.enqueue ?? enqueueJob;
  const asset = await db.query.assets.findFirst({
    where: eq(schema.assets.providerArchiveId, archiveId),
  });
  if (!asset) return { action: "unknown_archive" };
  if (asset.status !== "uploaded" && asset.status !== "recording") {
    return { action: "already_handled" };
  }
  const info = await deps.media.getArchive(archiveId);
  if (info.status === "failed") {
    await db.transaction(async (tx) => {
      await tx
        .update(schema.assets)
        .set({
          status: "failed",
          providerStatus: info.status,
          failureReason: info.reason ?? "provider reported failure",
          updatedAt: new Date(),
        })
        .where(eq(schema.assets.id, asset.id));
      await tx
        .update(schema.sessions)
        .set({ completeness: "incomplete" })
        .where(eq(schema.sessions.id, asset.sessionId));
    });
    return { action: "marked_failed" };
  }
  await db
    .update(schema.assets)
    .set({ providerStatus: info.status, updatedAt: new Date() })
    .where(eq(schema.assets.id, asset.id));
  if (info.status === "available") {
    await enqueue({
      type: "archive.fetch",
      payload: { archiveId },
      dedupeKey: `archive.fetch:${archiveId}`,
    });
    return { action: "fetch_enqueued" };
  }
  if (attempt >= RECONCILE_MAX_ATTEMPTS) return { action: "gave_up" };
  const next = attempt + 1;
  await enqueue({
    type: "archive.reconcile",
    payload: { archiveId, attempt: next },
    dedupeKey: `archive.reconcile:${archiveId}:${next}`,
    runAt: new Date(Date.now() + RECONCILE_DELAY_MS),
  });
  return { action: "requeued", attempt: next };
}

export async function reconcileArchiveJob(
  payload: { archiveId: string; attempt?: number },
  deps: ReconcileDeps,
): Promise<ReconcileResult> {
  return reconcileArchive(payload.archiveId, payload.attempt ?? 0, deps);
}

/** Queued right after a recording stops; the first check runs once the provider had time to close the file. */
export async function scheduleArchiveReconcile(
  archiveId: string,
  executor?: Parameters<typeof enqueueJob>[1],
) {
  return enqueueJob(
    {
      type: "archive.reconcile",
      payload: { archiveId, attempt: 0 },
      dedupeKey: `archive.reconcile:${archiveId}:0`,
      runAt: new Date(Date.now() + RECONCILE_DELAY_MS),
    },
    executor,
  );
}

/** Sweep half: one provider check for every uploaded asset that heard nothing for a while. */
export async function reconcileStaleArchives(deps: ReconcileDeps) {
  const stale = await db.query.assets.findMany({
    where: and(
      inArray(schema.assets.status, ["uploaded", "recording"]),
      lt(schema.assets.updatedAt, new Date(Date.now() - RECONCILE_GRACE_MS)),
    ),
    columns: { providerArchiveId: true },
  });
  const out: Array<{ archiveId: string; action: ReconcileResult["action"] }> = [];
  for (const a of stale) {
    if (!a.providerArchiveId) continue;
    const r = await reconcileArchive(a.providerArchiveId, RECONCILE_MAX_ATTEMPTS, deps);
    out.push({ archiveId: a.providerArchiveId, action: r.action });
  }
  return out;
}

/* ---------------- Job: fetch + verify archive ---------------- */

export type FetchDeps = { media: MediaClient; storage: StorageClient; fetchImpl?: typeof fetch };

export async function fetchArchiveJob(
  payload: { archiveId: string },
  deps: FetchDeps,
): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const asset = await db.query.assets.findFirst({
    where: eq(schema.assets.providerArchiveId, payload.archiveId),
  });
  if (!asset) throw new Error(`unknown archive ${payload.archiveId}`);
  if (asset.status === "verified") return;

  // Always ask the provider for a fresh signed URL; callback URLs expire after 10 minutes.
  const info = await deps.media.getArchive(payload.archiveId);
  if (info.status !== "available" || !info.url)
    throw new Error(`archive ${payload.archiveId} not available (status=${info.status})`);

  const res = await fetchImpl(info.url);
  if (!res.ok) throw new Error(`archive download failed: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (info.sizeBytes !== null && info.sizeBytes !== bytes.byteLength) {
    await db
      .update(schema.assets)
      .set({
        failureReason: `size mismatch: provider ${info.sizeBytes}, downloaded ${bytes.byteLength}`,
        updatedAt: new Date(),
      })
      .where(eq(schema.assets.id, asset.id));
    throw new Error(`archive ${payload.archiveId} size mismatch`);
  }

  const storagePath = `sessions/${asset.sessionId}/${asset.id}.mp4`;
  await deps.storage.upload(storagePath, bytes, "video/mp4");

  await db.transaction(async (tx) => {
    await tx
      .update(schema.assets)
      .set({
        status: "verified",
        providerStatus: info.status,
        storagePath,
        sizeBytes: bytes.byteLength,
        durationMs: info.durationSeconds !== null ? Math.round(info.durationSeconds * 1000) : null,
        failureReason: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.assets.id, asset.id));

    const session = await tx.query.sessions.findFirst({
      where: eq(schema.sessions.id, asset.sessionId),
    });
    if (!session) return;
    const all = await tx.query.assets.findMany({
      where: eq(schema.assets.sessionId, session.id),
      orderBy: asc(schema.assets.offsetMs),
    });
    const allVerified = all.every((a) => a.status === "verified");
    const anyFailed = all.some((a) => a.status === "failed" || a.status === "missing");
    const completeness = allVerified ? "complete" : anyFailed ? "partial" : "pending";
    await tx
      .update(schema.sessions)
      .set({ completeness, transcriptStatus: "queued" })
      .where(eq(schema.sessions.id, session.id));

    if (allVerified || anyFailed) {
      const assignment = await tx.query.assignments.findFirst({
        where: eq(schema.assignments.id, session.assignmentId),
      });
      if (assignment) {
        await emitEvent(tx, {
          type: "session.upload_verified",
          tenantId: assignment.tenantId,
          productId: assignment.productId,
          correlationId: assignment.studyId,
          idempotencyKey: `${session.id}:upload_verified`,
          payload: {
            session_id: session.id,
            assignment_id: assignment.id,
            completeness,
            asset_count: all.length,
          },
        });
        if (completeness === "complete") {
          await emitEvent(tx, {
            type: "session.analysis_ready",
            tenantId: assignment.tenantId,
            productId: assignment.productId,
            correlationId: session.id,
            idempotencyKey: `${session.id}:analysis_ready`,
            payload: { session_id: session.id, study_id: assignment.studyId },
          });
          await enqueueAnalysisForSession(tx, {
            tenantId: assignment.tenantId,
            studyId: assignment.studyId,
            sessionId: session.id,
            provider: env().ANALYSIS_PROVIDER,
            source: "persisted",
          });
        }
      }
    }

    await enqueueJob(
      {
        type: "asset.transcribe",
        tenantId: session.tenantId,
        payload: { assetId: asset.id },
        dedupeKey: `asset.transcribe:${asset.id}`,
      },
      tx,
    );
  });
}

/* ---------------- Job: transcribe one asset ---------------- */

export type TranscribeDeps = { storage: StorageClient; stt: SttClient };

export async function transcribeAssetJob(
  payload: { assetId: string },
  deps: TranscribeDeps,
): Promise<void> {
  const asset = await db.query.assets.findFirst({ where: eq(schema.assets.id, payload.assetId) });
  if (!asset?.storagePath) throw new Error(`asset ${payload.assetId} has no stored media`);
  const media = await deps.storage.download(asset.storagePath);

  let raw: unknown;
  try {
    raw = (await deps.stt.transcribe({ audio: media, filename: `${asset.id}.mp4` })).raw;
  } catch (err) {
    await db.transaction(async (tx) => {
      await tx
        .update(schema.assets)
        .set({ transcriptStatus: "failed", updatedAt: new Date() })
        .where(eq(schema.assets.id, asset.id));
      await tx
        .update(schema.sessions)
        .set({ transcriptStatus: "failed" })
        .where(eq(schema.sessions.id, asset.sessionId));
    });
    throw err;
  }
  const segments = mapDeepgramResponse(raw, { offsetMs: asset.offsetMs });

  await db.transaction(async (tx) => {
    await tx
      .delete(schema.transcriptSegments)
      .where(and(eq(schema.transcriptSegments.assetId, asset.id)));
    if (segments.length > 0) {
      await tx.insert(schema.transcriptSegments).values(
        segments.map((s) => ({
          id: newId("seg"),
          tenantId: asset.tenantId,
          sessionId: asset.sessionId,
          assetId: asset.id,
          startMs: s.start_ms,
          endMs: s.end_ms,
          speaker: s.speaker,
          text: s.text,
          confidence: s.confidence !== null ? Math.round(s.confidence * 1000) : null,
        })),
      );
    }
    // Per-asset status, not "has segments": a silent archive is transcribed too, just empty.
    await tx
      .update(schema.assets)
      .set({ transcriptStatus: "done", updatedAt: new Date() })
      .where(eq(schema.assets.id, asset.id));
    const all = await tx.query.assets.findMany({
      where: eq(schema.assets.sessionId, asset.sessionId),
    });
    const done = all
      .filter((a) => a.status === "verified")
      .every((a) => a.transcriptStatus === "done");
    if (done)
      await tx
        .update(schema.sessions)
        .set({ transcriptStatus: "done" })
        .where(eq(schema.sessions.id, asset.sessionId));
  });
}
