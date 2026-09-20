import { describe, expect, it } from "vitest";
import { SignalSchema } from "./signal";

const base = {
  schema_version: "1.0",
  signal_id: "signal_1",
  source: "jev",
  title: "Toolbar hesitation",
  description: "Repeated hesitation before selecting a tool.",
  severity: "medium",
  semantic_target: "toolbar.shapes",
  observed_sessions: ["obs_1", "obs_2"],
  window_start: "2026-09-19T00:00:00Z",
  window_end: "2026-09-19T12:00:00Z",
  evidence_ref: null,
};

describe("SignalSchema", () => {
  it("parses a valid signal", () => {
    expect(SignalSchema.parse(base)).toEqual(base);
  });

  it("rejects a bad severity", () => {
    expect(SignalSchema.safeParse({ ...base, severity: "critical" }).success).toBe(false);
  });

  it("rejects a missing window_end", () => {
    const { window_end: _omit, ...rest } = base;
    expect(SignalSchema.safeParse(rest).success).toBe(false);
  });

  it("compares window bounds by instant", () => {
    expect(
      SignalSchema.safeParse({
        ...base,
        window_start: "2025-01-01T01:00:00+01:00",
        window_end: "2024-12-31T23:30:00Z",
      }).success,
    ).toBe(false);
    expect(
      SignalSchema.safeParse({
        ...base,
        window_start: "2025-01-01T01:00:00+01:00",
        window_end: "2025-01-01T00:00:00Z",
      }).success,
    ).toBe(true);
  });
});
