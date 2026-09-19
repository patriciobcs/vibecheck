import { SAMPLE_STUDY_PLAN } from "@vibecheck/contracts";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/db/client";
import type { MediaClient } from "@/providers/vonage";
import { resetDb } from "@/test/db";
import { seedParticipant, seedStudy } from "@/test/fixtures";
import { claimAssignment } from "./assignments";
import {
  finishRecording,
  pauseRecording,
  recordConsent,
  resumeRecording,
  startArchive,
  startRecording,
  submitOutcome,
} from "./sessions";

beforeEach(resetDb);

function fakeMedia() {
  const calls: string[] = [];
  const archiveOptions: { hasVideo: boolean }[] = [];
  let n = 0;
  const client: MediaClient = {
    async createSession() {
      calls.push("createSession");
      return { sessionId: "vsess_1" };
    },
    clientToken: () => "tok",
    async startArchive(_sessionId, _name, opts) {
      calls.push("startArchive");
      archiveOptions.push({ hasVideo: opts?.hasVideo ?? true });
      n += 1;
      return { archiveId: `arch_${n}` };
    },
    async stopArchive(id) {
      calls.push(`stopArchive:${id}`);
    },
    async getArchive(id) {
      return {
        id,
        status: "stopped",
        durationSeconds: 10,
        sizeBytes: 1000,
        url: null,
        reason: null,
      };
    },
  };
  return { client, calls, archiveOptions };
}

async function assigned(overrides: Parameters<typeof seedStudy>[0] = {}) {
  const seeded = await seedStudy(overrides);
  const { participantId } = await seedParticipant();
  const claim = await claimAssignment({
    studyId: seeded.studyId,
    participantId,
    channel: "direct_link",
  });
  if (!claim.ok) throw new Error("claim failed");
  return { ...seeded, participantId, assignment: claim.assignment };
}

describe("recording lifecycle", () => {
  it("refuses to start recording before consent", async () => {
    const { assignment } = await assigned();
    const { client } = fakeMedia();
    const res = await startRecording({
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      media: client,
      instrumentation: "sdk",
      clientClockOriginMs: 1,
    });
    expect(res).toEqual({ ok: false, reason: "invalid_transition" });
  });

  it("starts a media session after consent; the archive starts once the client is connected", async () => {
    const { assignment } = await assigned();
    const { client, calls } = fakeMedia();
    await recordConsent({
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      consentVersion: "consent_v1",
    });
    const res = await startRecording({
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      media: client,
      instrumentation: "sdk",
      clientClockOriginMs: 1,
    });
    expect(res.ok).toBe(true);
    expect(calls).toEqual(["createSession"]);
    expect(await db.$count(schema.assets)).toBe(0);
    const arch = await startArchive({
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      media: client,
      tMs: 1500,
    });
    expect(arch.ok).toBe(true);
    expect(calls).toEqual(["createSession", "startArchive"]);
    const session = await db.query.sessions.findFirst();
    expect(session?.mediaSessionId).toBe("vsess_1");
    const assets = await db.query.assets.findMany();
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      providerArchiveId: "arch_1",
      status: "recording",
      offsetMs: 1500,
    });
    const a = await db.query.assignments.findFirst({
      where: eq(schema.assignments.id, assignment.id),
    });
    expect(a?.state).toBe("recording");
  });

  it("pause stops the archive and resume starts a new one at the right offset", async () => {
    const { assignment } = await assigned();
    const { client, calls } = fakeMedia();
    await recordConsent({
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      consentVersion: "consent_v1",
    });
    await startRecording({
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      media: client,
      instrumentation: "sdk",
      clientClockOriginMs: 1,
    });
    await startArchive({
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      media: client,
      tMs: 0,
    });
    await pauseRecording({
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      media: client,
      tMs: 30_000,
    });
    await resumeRecording({
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      media: client,
      tMs: 45_000,
    });
    expect(calls).toEqual(["createSession", "startArchive", "stopArchive:arch_1", "startArchive"]);
    const session = await db.query.sessions.findFirst();
    expect(session?.pauses).toEqual([{ start_ms: 30_000, end_ms: 45_000 }]);
    const assets = await db.query.assets.findMany({ orderBy: schema.assets.offsetMs });
    expect(assets.map((a) => [a.providerArchiveId, a.offsetMs, a.status])).toEqual([
      ["arch_1", 0, "uploaded"],
      ["arch_2", 45_000, "recording"],
    ]);
  });

  it("finish stops the archive, moves to submitting, and outcome submission completes with one credit", async () => {
    const { assignment } = await assigned();
    const { client } = fakeMedia();
    await recordConsent({
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      consentVersion: "consent_v1",
    });
    await startRecording({
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      media: client,
      instrumentation: "sdk",
      clientClockOriginMs: 1,
    });
    const fin = await finishRecording({
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      media: client,
      tMs: 120_000,
      reason: "finished",
    });
    expect(fin.ok).toBe(true);
    const out1 = await submitOutcome({
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      participantReported: "stuck",
      perceivedDifficulty: 4,
      comments: "Could not find it",
    });
    const out2 = await submitOutcome({
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      participantReported: "stuck",
      perceivedDifficulty: 4,
      comments: "dup",
    });
    expect(out1.ok && out2.ok).toBe(true);
    const a = await db.query.assignments.findFirst({
      where: eq(schema.assignments.id, assignment.id),
    });
    expect(a?.state).toBe("complete");
    const credits = await db.query.creditLedger.findMany();
    expect(credits).toHaveLength(1);
    const session = await db.query.sessions.findFirst();
    expect(session?.participantReportedOutcome).toBe("stuck");
    expect(session?.instrumentedOutcome).toBe("unknown");
  });

  it("records audio only when the study's capture policy turns the screen off", async () => {
    const { participantId, assignment, plan } = await assigned({
      capture: { ...SAMPLE_STUDY_PLAN.capture, screen: "off" },
    });
    expect(plan.capture.screen).toBe("off");
    const { client: media, archiveOptions } = fakeMedia();
    await recordConsent({ assignmentId: assignment.id, participantId, consentVersion: "v1" });
    const started = await startRecording({
      assignmentId: assignment.id,
      participantId,
      media,
      instrumentation: "sdk",
      clientClockOriginMs: 0,
    });
    expect(started.ok).toBe(true);
    await startArchive({ assignmentId: assignment.id, participantId, media, tMs: 0 });
    expect(archiveOptions).toEqual([{ hasVideo: false }]);
    expect((await db.query.assets.findFirst())?.kind).toBe("audio");
  });

  it("starting the archive twice is a no-op", async () => {
    const { assignment } = await assigned();
    const { client, calls } = fakeMedia();
    await recordConsent({
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      consentVersion: "consent_v1",
    });
    await startRecording({
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      media: client,
      instrumentation: "sdk",
      clientClockOriginMs: 1,
    });
    await startArchive({
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      media: client,
      tMs: 0,
    });
    await startArchive({
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      media: client,
      tMs: 0,
    });
    expect(calls.filter((c) => c === "startArchive")).toHaveLength(1);
  });

  it("a withdrawal marks the assignment withdrawn and stops any running archive", async () => {
    const { assignment } = await assigned();
    const { client, calls } = fakeMedia();
    await recordConsent({
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      consentVersion: "consent_v1",
    });
    await startRecording({
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      media: client,
      instrumentation: "sdk",
      clientClockOriginMs: 1,
    });
    await startArchive({
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      media: client,
      tMs: 0,
    });
    const res = await finishRecording({
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      media: client,
      tMs: 10_000,
      reason: "withdraw",
    });
    expect(res.ok).toBe(true);
    expect(calls.at(-1)).toBe("stopArchive:arch_1");
    const a = await db.query.assignments.findFirst({
      where: eq(schema.assignments.id, assignment.id),
    });
    expect(a?.state).toBe("withdrawn");
    expect(await db.$count(schema.creditLedger)).toBe(0);
  });

  it("another participant cannot act on the assignment", async () => {
    const { assignment } = await assigned();
    const res = await recordConsent({
      assignmentId: assignment.id,
      participantId: "someone_else",
      consentVersion: "consent_v1",
    });
    expect(res).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("pause and resume robustness", () => {
  it("pausing twice records one interval and is not an error", async () => {
    const { assignment } = await assigned();
    const { client, calls } = fakeMedia();
    await recordConsent({
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      consentVersion: "consent_v1",
    });
    await startRecording({
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      media: client,
      instrumentation: "sdk",
      clientClockOriginMs: 1,
    });
    await startArchive({
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      media: client,
      tMs: 0,
    });
    const p1 = await pauseRecording({
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      media: client,
      tMs: 5_000,
    });
    const p2 = await pauseRecording({
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      media: client,
      tMs: 6_000,
    });
    expect(p1.ok && p2.ok).toBe(true);
    expect((await db.query.sessions.findFirst())?.pauses).toEqual([
      { start_ms: 5_000, end_ms: null },
    ]);
    expect(calls.filter((c) => c.startsWith("stopArchive"))).toHaveLength(1);
  });

  it("a failed archive restart on resume keeps the session paused and reports media_unavailable", async () => {
    const { assignment } = await assigned();
    const { client } = fakeMedia();
    await recordConsent({
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      consentVersion: "consent_v1",
    });
    await startRecording({
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      media: client,
      instrumentation: "sdk",
      clientClockOriginMs: 1,
    });
    await startArchive({
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      media: client,
      tMs: 0,
    });
    await pauseRecording({
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      media: client,
      tMs: 5_000,
    });
    const failing = {
      ...client,
      startArchive: async () => {
        throw new Error("vonage down");
      },
    };
    const res = await resumeRecording({
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      media: failing,
      tMs: 8_000,
    });
    expect(res).toEqual({ ok: false, reason: "media_unavailable" });
    expect((await db.query.sessions.findFirst())?.pauses).toEqual([
      { start_ms: 5_000, end_ms: null },
    ]);
    const again = await resumeRecording({
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      media: client,
      tMs: 9_000,
    });
    expect(again.ok).toBe(true);
    expect((await db.query.sessions.findFirst())?.pauses).toEqual([
      { start_ms: 5_000, end_ms: 9_000 },
    ]);
  });
});
