import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/db/client";
import type { SttClient } from "@/providers/slng";
import type { StorageClient } from "@/providers/storage";
import type { MediaClient } from "@/providers/vonage";
import { resetDb } from "@/test/db";
import { seedParticipant, seedStudy } from "@/test/fixtures";
import { fetchArchiveJob, handleArchiveCallback, transcribeAssetJob } from "./archive-pipeline";
import { claimAssignment } from "./assignments";
import { finishRecording, recordConsent, startArchive, startRecording } from "./sessions";

beforeEach(resetDb);

const media: MediaClient = {
  createSession: async () => ({ sessionId: "vsess" }),
  clientToken: () => "t",
  startArchive: async () => ({ archiveId: "arch_1" }),
  stopArchive: async () => {},
  getArchive: async (id) => ({
    id,
    status: "available",
    durationSeconds: 12,
    sizeBytes: 5,
    url: "https://archive.example/a.mp4",
    reason: null,
  }),
};

function fakeStorage() {
  const files = new Map<string, Uint8Array>();
  const client: StorageClient = {
    ensureBucket: async () => {},
    upload: async (path, body) => {
      files.set(path, body instanceof Blob ? new Uint8Array(await body.arrayBuffer()) : body);
      return { path };
    },
    download: async (path) => new Blob([Buffer.from(files.get(path) ?? new Uint8Array())]),
    signedUrl: async (path) => `signed:${path}`,
    remove: async () => {},
  };
  return { client, files };
}

const stt: SttClient = {
  transcribe: async () => ({
    requestId: "req",
    raw: {
      metadata: {},
      results: {
        channels: [{ alternatives: [{ transcript: "hi there", words: [] }] }],
        utterances: [{ start: 0.5, end: 1.0, transcript: "hi there", confidence: 0.9 }],
      },
    },
  }),
};

const fetchImpl: typeof fetch = async () =>
  new Response(new Uint8Array([1, 2, 3, 4, 5]), { status: 200 });

async function finishedSession() {
  const { studyId } = await seedStudy();
  const { participantId } = await seedParticipant();
  const claim = await claimAssignment({ studyId, participantId, channel: "marketplace" });
  if (!claim.ok) throw new Error("claim");
  await recordConsent({
    assignmentId: claim.assignment.id,
    participantId,
    consentVersion: "consent_v1",
  });
  const started = await startRecording({
    assignmentId: claim.assignment.id,
    participantId,
    media,
    instrumentation: "sdk",
    clientClockOriginMs: 0,
  });
  if (!started.ok) throw new Error("start");
  await startArchive({ assignmentId: claim.assignment.id, participantId, media, tMs: 0 });
  await finishRecording({
    assignmentId: claim.assignment.id,
    participantId,
    media,
    tMs: 12_000,
    reason: "finished",
  });
  return { sessionId: started.sessionId };
}

describe("handleArchiveCallback", () => {
  it("records the receipt once and enqueues a fetch job when the archive is available", async () => {
    await finishedSession();
    const body = {
      id: "arch_1",
      event: "archive",
      status: "available",
      sessionId: "vsess",
      url: "https://x",
      duration: 12,
      size: 5,
    };
    const r1 = await handleArchiveCallback(body);
    const r2 = await handleArchiveCallback(body);
    expect(r1).toEqual({ ok: true, duplicate: false, action: "fetch_enqueued" });
    expect(r2).toEqual({ ok: true, duplicate: true });
    expect(await db.$count(schema.jobs)).toBe(1);
    const asset = await db.query.assets.findFirst();
    expect(asset?.providerStatus).toBe("available");
  });

  it("does not keep the receipt when processing fails, so the provider's retry is handled", async () => {
    await finishedSession();
    const body = { id: "arch_1", event: "archive", status: "available", url: "https://x" };
    await expect(
      handleArchiveCallback(body, {
        enqueue: async () => {
          throw new Error("queue unavailable");
        },
      }),
    ).rejects.toThrow("queue unavailable");
    expect(await db.$count(schema.webhookReceipts)).toBe(0);
    expect(await handleArchiveCallback(body)).toEqual({
      ok: true,
      duplicate: false,
      action: "fetch_enqueued",
    });
    expect(await db.$count(schema.jobs)).toBe(1);
  });

  it("marks the asset failed on a failed status", async () => {
    await finishedSession();
    await handleArchiveCallback({
      id: "arch_1",
      event: "archive",
      status: "failed",
      reason: "Internal server failure",
    });
    const asset = await db.query.assets.findFirst();
    expect(asset?.status).toBe("failed");
    expect(asset?.failureReason).toContain("Internal");
    const session = await db.query.sessions.findFirst();
    expect(session?.completeness).toBe("incomplete");
  });

  it("ignores archives we do not know", async () => {
    expect(
      await handleArchiveCallback({ id: "ghost", event: "archive", status: "available" }),
    ).toEqual({ ok: true, duplicate: false, action: "unknown_archive" });
  });
});

describe("fetchArchiveJob", () => {
  it("downloads, stores, verifies size, marks the session complete and queues transcription", async () => {
    const { sessionId } = await finishedSession();
    const { client: storage, files } = fakeStorage();
    const asset = await db.query.assets.findFirst();
    if (!asset) throw new Error("asset");
    await fetchArchiveJob({ archiveId: "arch_1" }, { media, storage, fetchImpl });
    const updated = await db.query.assets.findFirst({ where: eq(schema.assets.id, asset.id) });
    expect(updated).toMatchObject({ status: "verified", sizeBytes: 5, durationMs: 12_000 });
    expect(files.has(updated?.storagePath ?? "")).toBe(true);
    const session = await db.query.sessions.findFirst({ where: eq(schema.sessions.id, sessionId) });
    expect(session?.completeness).toBe("complete");
    expect(session?.transcriptStatus).toBe("queued");
    const events = await db.query.eventOutbox.findMany();
    expect(events.map((e) => e.eventType)).toContain("session.upload_verified");
    const jobs = await db.query.jobs.findMany();
    expect(jobs.map((j) => j.type)).toContain("asset.transcribe");
  });

  it("fails verification when the downloaded size differs from the provider's size", async () => {
    await finishedSession();
    const { client: storage } = fakeStorage();
    const badMedia: MediaClient = {
      ...media,
      getArchive: async (id) => ({
        id,
        status: "available",
        durationSeconds: 12,
        sizeBytes: 999,
        url: "https://x",
        reason: null,
      }),
    };
    await expect(
      fetchArchiveJob({ archiveId: "arch_1" }, { media: badMedia, storage, fetchImpl }),
    ).rejects.toThrow(/size mismatch/);
    const asset = await db.query.assets.findFirst();
    expect(asset?.status).not.toBe("verified");
  });
});

describe("transcribeAssetJob", () => {
  it("stores transcript segments offset by the asset start and marks the transcript done", async () => {
    await finishedSession();
    const { client: storage } = fakeStorage();
    await fetchArchiveJob({ archiveId: "arch_1" }, { media, storage, fetchImpl });
    const asset = await db.query.assets.findFirst();
    if (!asset) throw new Error("asset");
    await db.update(schema.assets).set({ offsetMs: 30_000 }).where(eq(schema.assets.id, asset.id));
    await transcribeAssetJob({ assetId: asset.id }, { storage, stt });
    await transcribeAssetJob({ assetId: asset.id }, { storage, stt });
    const segments = await db.query.transcriptSegments.findMany();
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      startMs: 30_500,
      endMs: 31_000,
      text: "hi there",
      confidence: 900,
    });
    const session = await db.query.sessions.findFirst();
    expect(session?.transcriptStatus).toBe("done");
    expect(asset && (await db.query.assets.findFirst())?.transcriptStatus).toBe("done");
  });

  it("a silent asset counts as transcribed, so a multi-archive session still finishes", async () => {
    const { sessionId } = await finishedSession();
    const { client: storage } = fakeStorage();
    await fetchArchiveJob({ archiveId: "arch_1" }, { media, storage, fetchImpl });
    const first = await db.query.assets.findFirst();
    if (!first) throw new Error("asset");
    await db.insert(schema.assets).values({
      id: "asset_silent",
      tenantId: first.tenantId,
      sessionId,
      kind: "screen_audio",
      providerArchiveId: "arch_2",
      status: "verified",
      offsetMs: 60_000,
      storagePath: first.storagePath,
    });
    const silent: SttClient = {
      transcribe: async () => ({
        requestId: "req",
        raw: { metadata: {}, results: { channels: [], utterances: [] } },
      }),
    };
    await transcribeAssetJob({ assetId: "asset_silent" }, { storage, stt: silent });
    expect((await db.query.sessions.findFirst())?.transcriptStatus).toBe("queued");
    await transcribeAssetJob({ assetId: first.id }, { storage, stt });
    expect((await db.query.sessions.findFirst())?.transcriptStatus).toBe("done");
    expect(await db.$count(schema.transcriptSegments)).toBe(1);
  });

  it("marks the session transcript failed when the provider fails", async () => {
    await finishedSession();
    const { client: storage } = fakeStorage();
    await fetchArchiveJob({ archiveId: "arch_1" }, { media, storage, fetchImpl });
    const asset = await db.query.assets.findFirst();
    if (!asset) throw new Error("asset");
    const broken: SttClient = {
      transcribe: async () => {
        throw new Error("stt down");
      },
    };
    await expect(
      transcribeAssetJob({ assetId: asset.id }, { storage, stt: broken }),
    ).rejects.toThrow("stt down");
    expect((await db.query.assets.findFirst())?.transcriptStatus).toBe("failed");
    expect((await db.query.sessions.findFirst())?.transcriptStatus).toBe("failed");
  });
});
