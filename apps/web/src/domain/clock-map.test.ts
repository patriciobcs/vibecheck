import { describe, expect, it } from "vitest";
import { activeDurationMs, buildClockMap } from "./clock-map";

describe("buildClockMap", () => {
  it("maps each asset to its session offset and records pauses", () => {
    const map = buildClockMap({
      sessionStartedAt: new Date("2026-09-19T10:00:00.000Z"),
      assets: [
        { asset_ref: "a1", offset_ms: 0, duration_ms: 60_000 },
        { asset_ref: "a2", offset_ms: 90_000, duration_ms: 30_000 },
      ],
      pauses: [{ start_ms: 60_000, end_ms: 90_000 }],
    });
    expect(map).toEqual({
      schema_version: "1.0",
      session_started_at: "2026-09-19T10:00:00.000Z",
      media: [
        { asset_ref: "a1", session_offset_ms: 0, duration_ms: 60_000 },
        { asset_ref: "a2", session_offset_ms: 90_000, duration_ms: 30_000 },
      ],
      pauses: [{ start_ms: 60_000, end_ms: 90_000 }],
    });
  });
});

describe("activeDurationMs", () => {
  it("excludes documented pauses", () => {
    expect(
      activeDurationMs({ totalMs: 120_000, pauses: [{ start_ms: 60_000, end_ms: 90_000 }] }),
    ).toBe(90_000);
  });

  it("treats an open pause as running to the end", () => {
    expect(
      activeDurationMs({ totalMs: 120_000, pauses: [{ start_ms: 100_000, end_ms: null }] }),
    ).toBe(100_000);
  });
});
