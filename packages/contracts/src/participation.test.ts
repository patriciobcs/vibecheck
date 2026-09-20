import { describe, expect, it } from "vitest";
import { ParticipationEventSchema } from "./participation";

describe("ParticipationEventSchema", () => {
  it("requires a session for session participation events", () => {
    const result = ParticipationEventSchema.safeParse({
      schema_version: "1.0",
      event_id: "event_1",
      study_id: "study_1",
      study_revision: 1,
      participant_ref: "participant_1",
      kind: "started",
      occurred_at: "2026-09-19T10:00:00Z",
      session_id: null,
    });

    expect(result.success).toBe(false);
  });
});
