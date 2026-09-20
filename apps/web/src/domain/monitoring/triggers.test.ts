import { describe, expect, it } from "vitest";
import { evaluateTriggers, type JourneyEvent } from "./triggers";

const policy = { window_ms: 90_000, normal_journey_sample_rate: 0.01 };
const ev = (over: Partial<JourneyEvent>): JourneyEvent => ({
  id: over.id ?? `e${Math.random()}`,
  sequence: 0,
  t_ms: 0,
  type: "progress",
  payload: {},
  ...over,
});

describe("evaluateTriggers", () => {
  it("fires repeated_failure for two distinct failed attempts of the same action within 30s", () => {
    const events = [
      ev({ sequence: 0, t_ms: 0, type: "journey_start" }),
      ev({
        sequence: 1,
        t_ms: 1000,
        type: "action_result",
        payload: { action_ref: "export", attempt_id: "a1", result: "failed" },
      }),
      ev({
        sequence: 2,
        t_ms: 12_000,
        type: "action_result",
        payload: { action_ref: "export", attempt_id: "a2", result: "failed" },
      }),
    ];
    expect(
      evaluateTriggers(events, { nowMs: 13_000, policy, journeyInstanceId: "j1" }).map(
        (t) => t.reason,
      ),
    ).toContain("repeated_failure");
  });

  it("does not count duplicate network events of one attempt as two failures", () => {
    const events = [
      ev({ sequence: 0, t_ms: 0, type: "journey_start" }),
      ev({
        sequence: 1,
        t_ms: 1000,
        type: "action_result",
        payload: { action_ref: "export", attempt_id: "a1", result: "failed" },
      }),
      ev({
        sequence: 2,
        t_ms: 1200,
        type: "action_result",
        payload: { action_ref: "export", attempt_id: "a1", result: "failed" },
      }),
    ];
    expect(
      evaluateTriggers(events, { nowMs: 2000, policy, journeyInstanceId: "j1" }).map(
        (t) => t.reason,
      ),
    ).not.toContain("repeated_failure");
  });

  it("fires navigation_loop for A→B→A→B within 90s without progress, but not with progress in between", () => {
    const loop = [
      ev({ sequence: 0, t_ms: 0, type: "journey_start" }),
      ev({ sequence: 1, t_ms: 1000, type: "navigation", payload: { route_template: "/a" } }),
      ev({ sequence: 2, t_ms: 5000, type: "navigation", payload: { route_template: "/b" } }),
      ev({ sequence: 3, t_ms: 9000, type: "navigation", payload: { route_template: "/a" } }),
      ev({ sequence: 4, t_ms: 12_000, type: "navigation", payload: { route_template: "/b" } }),
    ];
    expect(
      evaluateTriggers(loop, { nowMs: 13_000, policy, journeyInstanceId: "j1" }).map(
        (t) => t.reason,
      ),
    ).toContain("navigation_loop");
    const withProgress = [
      ...loop.slice(0, 3),
      ev({ sequence: 3, t_ms: 8000, type: "progress", payload: { progress_ref: "step" } }),
      ...loop.slice(3),
    ];
    expect(
      evaluateTriggers(withProgress, { nowMs: 13_000, policy, journeyInstanceId: "j1" }).map(
        (t) => t.reason,
      ),
    ).not.toContain("navigation_loop");
  });

  it("fires help_request only for an explicit help event", () => {
    const events = [
      ev({ sequence: 0, t_ms: 0, type: "journey_start" }),
      ev({ sequence: 1, t_ms: 500, type: "help_request" }),
    ];
    expect(
      evaluateTriggers(events, { nowMs: 1000, policy, journeyInstanceId: "j1" }).map(
        (t) => t.reason,
      ),
    ).toContain("help_request");
  });

  it("possible_stall needs 60s without progress, visibility, recent interaction and working progress instrumentation", () => {
    const base = [
      ev({ sequence: 0, t_ms: 0, type: "journey_start" }),
      ev({ sequence: 1, t_ms: 100, type: "progress", payload: { progress_ref: "started" } }),
    ];
    const withInteraction = [
      ...base,
      ev({
        sequence: 2,
        t_ms: 50_000,
        type: "action_attempt",
        payload: { action_ref: "export", attempt_id: "a1" },
      }),
    ];
    expect(
      evaluateTriggers(withInteraction, {
        nowMs: 65_000,
        policy,
        journeyInstanceId: "j1",
        visible: true,
      }).map((t) => t.reason),
    ).toContain("possible_stall");
    expect(
      evaluateTriggers(withInteraction, {
        nowMs: 65_000,
        policy,
        journeyInstanceId: "j1",
        visible: false,
      }).map((t) => t.reason),
    ).not.toContain("possible_stall");
    const noProgressInstrumentation = [
      ev({ sequence: 0, t_ms: 0, type: "journey_start" }),
      ev({
        sequence: 1,
        t_ms: 50_000,
        type: "action_attempt",
        payload: { action_ref: "x", attempt_id: "a" },
      }),
    ];
    expect(
      evaluateTriggers(noProgressInstrumentation, {
        nowMs: 65_000,
        policy,
        journeyInstanceId: "j1",
        visible: true,
      }).map((t) => t.reason),
    ).not.toContain("possible_stall");
  });

  it("journey_end is a completion, an explicit exit, or 5 minutes of silence", () => {
    const start = ev({ sequence: 0, t_ms: 0, type: "journey_start" });
    expect(
      evaluateTriggers([start, ev({ sequence: 1, t_ms: 100, type: "completion" })], {
        nowMs: 200,
        policy,
        journeyInstanceId: "j1",
      }).map((t) => t.reason),
    ).toContain("journey_end");
    expect(
      evaluateTriggers([start], { nowMs: 5 * 60_000 + 1, policy, journeyInstanceId: "j1" }).find(
        (t) => t.reason === "journey_end",
      )?.outcome,
    ).toBe("unknown");
    expect(
      evaluateTriggers([start], { nowMs: 60_000, policy, journeyInstanceId: "j1" }).map(
        (t) => t.reason,
      ),
    ).not.toContain("journey_end");
  });

  it("normal_sample is a stable 1% selection of otherwise untriggered journey ends", () => {
    const start = ev({ sequence: 0, t_ms: 0, type: "journey_start" });
    const done = ev({ sequence: 1, t_ms: 100, type: "completion" });
    const sampled = Array.from({ length: 2000 }, (_, i) =>
      evaluateTriggers([start, done], { nowMs: 200, policy, journeyInstanceId: `j${i}` }).some(
        (t) => t.reason === "normal_sample",
      ),
    );
    const count = sampled.filter(Boolean).length;
    expect(count).toBeGreaterThan(5);
    expect(count).toBeLessThan(60);
    const twice = [1, 2].map(() =>
      evaluateTriggers([start, done], { nowMs: 200, policy, journeyInstanceId: "fixed" }).some(
        (t) => t.reason === "normal_sample",
      ),
    );
    expect(twice[0]).toBe(twice[1]);
  });
});
