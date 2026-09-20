import { SessionManifestSchema } from "@vibecheck/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import type { StorageClient } from "@/providers/storage";
import type { MediaClient } from "@/providers/vonage";
import { resetDb } from "@/test/db";
import { seedParticipant, seedStudy } from "@/test/fixtures";
import { fetchArchiveJob } from "./archive-pipeline";
import { claimAssignment } from "./assignments";
import { buildSessionManifest } from "./manifest";
import {
  finishRecording,
  recordConsent,
  startArchive,
  startRecording,
  submitOutcome,
} from "./sessions";

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
    url: "https://x/a.mp4",
    reason: null,
  }),
};
const storage: StorageClient = {
  ensureBucket: async () => {},
  upload: async (path) => ({ path }),
  download: async () => new Blob([]),
  signedUrl: async (p) => `signed:${p}`,
  remove: async () => {},
};
const fetchImpl: typeof fetch = async () =>
  new Response(new Uint8Array([1, 2, 3, 4, 5]), { status: 200 });

describe("buildSessionManifest", () => {
  it("produces a valid VC-02 → VC-03 manifest for a completed session", async () => {
    const { studyId, plan } = await seedStudy();
    const { participantId } = await seedParticipant();
    const claim = await claimAssignment({ studyId, participantId, channel: "embedded" });
    if (!claim.ok) throw new Error("claim");
    const id = claim.assignment.id;
    await recordConsent({ assignmentId: id, participantId, consentVersion: "consent_v1" });
    const started = await startRecording({
      assignmentId: id,
      participantId,
      media,
      instrumentation: "sdk",
      clientClockOriginMs: 1,
    });
    if (!started.ok) throw new Error("start");
    await startArchive({ assignmentId: id, participantId, media, tMs: 4000 });
    await finishRecording({
      assignmentId: id,
      participantId,
      media,
      tMs: 16_000,
      reason: "finished",
    });
    await submitOutcome({
      assignmentId: id,
      participantId,
      participantReported: "stuck",
      perceivedDifficulty: 4,
      comments: null,
    });
    await fetchArchiveJob({ archiveId: "arch_1" }, { media, storage, fetchImpl });

    const manifest = await buildSessionManifest(started.sessionId);
    if (!manifest) throw new Error("no manifest");
    expect(SessionManifestSchema.parse(manifest)).toEqual(manifest);
    expect(manifest).toMatchObject({
      session_id: started.sessionId,
      assignment_id: id,
      study_revision: 1,
      tested_commit_sha: plan.baseline.commit_sha,
      consent_version: "consent_v1",
      completeness: "complete",
      instrumentation: "sdk",
      outcome: { participant_reported: "stuck", instrumented: "unknown" },
    });
    expect(manifest.assets[0]).toMatchObject({
      kind: "screen_audio",
      status: "verified",
      duration_ms: 12_000,
    });
    expect(manifest.events_ref).toBe(`events:${started.sessionId}`);
    expect(manifest.clock_map_ref).toBe(`clockmap:${started.sessionId}`);
    expect(manifest.transcript_ref).toBeNull(); // not transcribed yet
    const asset = await db.query.assets.findFirst({
      where: (a, { eq }) => eq(a.sessionId, started.sessionId),
    });
    expect(manifest.assets[0]?.asset_ref).toBe(asset?.id);
  });

  it("is null for an unknown session", async () => {
    expect(await buildSessionManifest("nope")).toBeNull();
  });
});
