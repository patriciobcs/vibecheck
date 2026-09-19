import { describe, expect, it } from "vitest";
import { ClientEventSchema, SessionManifestSchema, TranscriptSegmentSchema } from "./session";

describe("ClientEventSchema", () => {
  const click = {
    session_id: "session_1",
    sequence: 1,
    t_ms: 1200,
    type: "click",
    safe_target_ref: "button#book",
    viewport: { width: 1280, height: 720 },
    coordinates: { x: 10, y: 20 },
  };

  it("accepts a click event", () => {
    expect(ClientEventSchema.parse(click)).toEqual(click);
  });

  it("rejects an event that carries typed text", () => {
    expect(ClientEventSchema.safeParse({ ...click, type: "keydown", text: "hello" }).success).toBe(
      false,
    );
  });

  it("rejects keydown with a non-semantic key", () => {
    expect(ClientEventSchema.safeParse({ ...click, type: "keydown", key: "a" }).success).toBe(
      false,
    );
  });

  it("accepts keydown with a semantic key", () => {
    const ev = { ...click, type: "keydown", key: "Enter" };
    expect(ClientEventSchema.parse(ev)).toEqual(ev);
  });

  it("rejects negative t_ms", () => {
    expect(ClientEventSchema.safeParse({ ...click, t_ms: -1 }).success).toBe(false);
  });
});

describe("TranscriptSegmentSchema", () => {
  it("rejects end before start", () => {
    expect(
      TranscriptSegmentSchema.safeParse({
        segment_id: "seg_1",
        start_ms: 500,
        end_ms: 400,
        speaker: "participant",
        text: "hi",
      }).success,
    ).toBe(false);
  });
});

describe("SessionManifestSchema", () => {
  it("accepts the sample manifest from VC-02", () => {
    const manifest = {
      schema_version: "1.0",
      session_id: "session_example",
      assignment_id: "assignment_example",
      study_revision: 1,
      tested_commit_sha: "0000000000000000000000000000000000000000",
      consent_version: "consent_v1",
      capture_policy_ref: "capture_snapshot_example",
      assets: [
        {
          kind: "screen_audio",
          asset_ref: "asset_example",
          status: "verified",
          duration_ms: 185000,
        },
      ],
      events_ref: "events_example",
      transcript_ref: "transcript_example",
      clock_map_ref: "clock_example",
      completeness: "complete",
      instrumentation: "sdk",
      outcome: { participant_reported: "stuck", instrumented: "not_completed" },
    };
    expect(SessionManifestSchema.parse(manifest)).toEqual(manifest);
  });

  it("allows missing transcript_ref while completeness is partial", () => {
    const manifest = {
      schema_version: "1.0",
      session_id: "s",
      assignment_id: "a",
      study_revision: 1,
      tested_commit_sha: "0000000000000000000000000000000000000000",
      consent_version: "consent_v1",
      capture_policy_ref: "cap",
      assets: [],
      events_ref: null,
      transcript_ref: null,
      clock_map_ref: null,
      completeness: "partial",
      instrumentation: "video_only",
      outcome: { participant_reported: "unknown", instrumented: "unknown" },
    };
    expect(SessionManifestSchema.safeParse(manifest).success).toBe(true);
  });
});
