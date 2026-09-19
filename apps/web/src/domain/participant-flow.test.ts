import { describe, expect, it } from "vitest";
import { canTransition, PARTICIPANT_STATES, transition } from "./participant-flow";

describe("participant flow", () => {
  it("lists the VC-02 states in order", () => {
    expect(PARTICIPANT_STATES).toEqual([
      "invited",
      "eligible",
      "assigned",
      "consent",
      "device_check",
      "recording",
      "submitting",
      "complete",
      "withdrawn",
      "expired",
      "incomplete",
    ]);
  });

  it("moves forward one step at a time", () => {
    expect(transition("assigned", "consent")).toEqual({ ok: true, state: "consent" });
    expect(transition("consent", "device_check")).toEqual({ ok: true, state: "device_check" });
    expect(transition("device_check", "recording")).toEqual({ ok: true, state: "recording" });
  });

  it("refuses to skip consent", () => {
    expect(canTransition("assigned", "recording")).toBe(false);
    expect(transition("assigned", "recording")).toEqual({
      ok: false,
      reason: "invalid_transition",
    });
  });

  it("allows withdraw from any active state", () => {
    for (const from of [
      "assigned",
      "consent",
      "device_check",
      "recording",
      "submitting",
    ] as const) {
      expect(canTransition(from, "withdrawn")).toBe(true);
    }
  });

  it("does not allow leaving a terminal state", () => {
    expect(canTransition("complete", "recording")).toBe(false);
    expect(canTransition("withdrawn", "assigned")).toBe(false);
    expect(canTransition("expired", "consent")).toBe(false);
  });

  it("marks recording incomplete on failure, never complete", () => {
    expect(canTransition("recording", "incomplete")).toBe(true);
    expect(canTransition("recording", "complete")).toBe(false);
  });
});
