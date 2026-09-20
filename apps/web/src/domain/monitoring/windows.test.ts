import { describe, expect, it } from "vitest";
import type { JourneyEvent } from "./triggers";
import { buildWindow } from "./windows";

const ev = (
  sequence: number,
  t_ms: number,
  type: string,
  payload: Record<string, unknown> = {},
): JourneyEvent => ({ id: `e${sequence}`, sequence, t_ms, type, payload });

const base = {
  journeyInstanceId: "j1",
  observationSessionId: "obs",
  journeyId: "share_drawing",
  buildRef: "b1",
  detectorRef: "det:1",
  policyRef: "pol:1",
  requiredEvents: ["journey_start", "progress", "completion"],
  windowMs: 90_000,
  maxInputChars: 4000,
};

describe("buildWindow", () => {
  it("keeps the last window of events, summarises earlier progress, and records coverage", () => {
    const events = [
      ev(0, 0, "journey_start"),
      ev(1, 5000, "progress", { progress_ref: "drawing_started" }),
      ev(2, 100_000, "action_attempt", { action_ref: "export", attempt_id: "a1" }),
      ev(3, 110_000, "action_result", { action_ref: "export", attempt_id: "a1", result: "failed" }),
    ];
    const w = buildWindow(events, { ...base, nowMs: 120_000, triggerReason: "repeated_failure" });
    expect(w.eventIds).toEqual(["e2", "e3"]);
    expect(w.startMs).toBe(30_000);
    expect(w.priorProgressSummary).toEqual({
      events: 2,
      last_progress_ref: "drawing_started",
      last_progress_t_ms: 5000,
      types: { journey_start: 1, progress: 1 },
    });
    expect(w.coverage).toEqual({
      required: ["journey_start", "progress", "completion"],
      observed: ["journey_start", "progress", "action_attempt", "action_result"],
      missing: ["completion"],
      dropped_events: 0,
    });
    expect(w.goalSource).toBe("declared");
  });

  it("records sequence gaps instead of pretending coverage", () => {
    const events = [ev(0, 0, "journey_start"), ev(3, 3000, "help_request")];
    const w = buildWindow(events, { ...base, nowMs: 4000, triggerReason: "help_request" });
    expect(w.gaps).toEqual([{ after_sequence: 0, missing: 2 }]);
  });

  it("content hash is stable for the same events and changes with new evidence", () => {
    const events = [ev(0, 0, "journey_start"), ev(1, 1000, "help_request")];
    const a = buildWindow(events, { ...base, nowMs: 2000, triggerReason: "help_request" });
    const b = buildWindow(events, { ...base, nowMs: 9000, triggerReason: "help_request" });
    const c = buildWindow([...events, ev(2, 3000, "progress", { progress_ref: "x" })], {
      ...base,
      nowMs: 9000,
      triggerReason: "help_request",
    });
    expect(a.contentHash).toBe(b.contentHash);
    expect(c.contentHash).not.toBe(a.contentHash);
  });

  it("truncates to the input budget while keeping terminal outcomes and marking omitted ranges", () => {
    const many = Array.from({ length: 300 }, (_, i) =>
      ev(i, i * 100, i === 299 ? "completion" : "progress", { progress_ref: `p${i}` }),
    );
    const w = buildWindow(many, {
      ...base,
      nowMs: 31_000,
      maxInputChars: 1500,
      triggerReason: "journey_end",
    });
    expect(w.eventIds.at(-1)).toBe("e299");
    expect(w.omitted).toBeGreaterThan(0);
    expect(JSON.stringify(w.state).length).toBeLessThanOrEqual(2200);
  });
});
