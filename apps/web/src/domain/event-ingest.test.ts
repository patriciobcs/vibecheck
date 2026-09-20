import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/db/client";
import type { MediaClient } from "@/providers/vonage";
import { resetDb } from "@/test/db";
import { seedParticipant, seedStudy } from "@/test/fixtures";
import { claimAssignment } from "./assignments";
import { ingestEventBatch } from "./event-ingest";
import { recordConsent, startArchive, startRecording } from "./sessions";

beforeEach(resetDb);

const media: MediaClient = {
  createSession: async () => ({ sessionId: "v" }),
  clientToken: () => "t",
  startArchive: async () => ({ archiveId: "a1" }),
  stopArchive: async () => {},
  getArchive: async (id) => ({
    id,
    status: "stopped",
    durationSeconds: 1,
    sizeBytes: 1,
    url: null,
    reason: null,
  }),
};

async function recordingSession() {
  const { studyId } = await seedStudy();
  const { participantId } = await seedParticipant();
  const claim = await claimAssignment({ studyId, participantId, channel: "embedded" });
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
    clientClockOriginMs: 1,
  });
  if (!started.ok) throw new Error("start");
  await startArchive({ assignmentId: claim.assignment.id, participantId, media, tMs: 0 });
  return { sessionId: started.sessionId, participantId };
}

describe("ingestEventBatch", () => {
  it("stores valid events once even when the batch is re-sent", async () => {
    const { sessionId, participantId } = await recordingSession();
    const batch = {
      session_id: sessionId,
      batch_sequence: 0,
      events: [
        {
          session_id: sessionId,
          sequence: 0,
          t_ms: 10,
          type: "click",
          safe_target_ref: "button#book",
        },
        {
          session_id: sessionId,
          sequence: 1,
          t_ms: 20,
          type: "navigation",
          path: "https://app.example.test/book?x=1",
        },
      ],
    };
    const r1 = await ingestEventBatch({ participantId, batch });
    const r2 = await ingestEventBatch({ participantId, batch });
    expect(r1).toEqual({ ok: true, stored: 2, duplicate: false });
    expect(r2).toEqual({ ok: true, stored: 0, duplicate: true });
    const rows = await db.query.sessionEvents.findMany({ orderBy: schema.sessionEvents.sequence });
    expect(rows).toHaveLength(2);
    expect(rows[1]?.payload).toMatchObject({ path: "https://app.example.test/book" });
  });

  it("rejects a batch containing typed text", async () => {
    const { sessionId, participantId } = await recordingSession();
    const res = await ingestEventBatch({
      participantId,
      batch: {
        session_id: sessionId,
        batch_sequence: 0,
        events: [
          {
            session_id: sessionId,
            sequence: 0,
            t_ms: 1,
            type: "keydown",
            key: "Enter",
            text: "pw",
          },
        ],
      },
    });
    expect(res.ok).toBe(false);
    expect(await db.$count(schema.sessionEvents)).toBe(0);
  });

  it("rejects events for a session the participant does not own", async () => {
    const { sessionId } = await recordingSession();
    const res = await ingestEventBatch({
      participantId: "intruder",
      batch: { session_id: sessionId, batch_sequence: 0, events: [] },
    });
    expect(res).toEqual({ ok: false, reason: "not_found" });
  });
});
