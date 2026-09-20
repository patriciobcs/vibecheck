import { describe, expect, it } from "vitest";
import { journeyMetrics } from "./journey-metrics";

const ev = (
  sequence: number,
  t_ms: number,
  type: string,
  payload: Record<string, unknown> = {},
) => ({
  id: `e${sequence}`,
  sequence,
  t_ms,
  type,
  payload,
});

describe("journeyMetrics", () => {
  it("is empty for no events", () => {
    expect(journeyMetrics([])).toEqual({
      durationMs: 0,
      events: 0,
      attempts: 0,
      detours: 0,
      failures: 0,
      helpRequests: 0,
      navigations: 0,
      outcome: "not_started",
      timeToGoalMs: null,
      firstDetourMs: null,
      distinctActions: [],
    });
  });

  it("counts detours, help and time to goal on the share-versus-export journey", () => {
    const m = journeyMetrics([
      ev(0, 0, "journey_start", { journey_id: "share_drawing" }),
      ev(1, 100, "progress", { progress_ref: "drawing_started" }),
      ev(2, 4000, "navigation", { route_template: "/dialog/share" }),
      ev(3, 4000, "action_attempt", { action_ref: "share_button", attempt_id: "share_1" }),
      ev(4, 6000, "navigation", { route_template: "/canvas" }),
      ev(5, 6000, "action_result", {
        action_ref: "share_button",
        attempt_id: "share_1",
        result: "cancelled",
      }),
      ev(6, 9000, "action_attempt", { action_ref: "share_button", attempt_id: "share_2" }),
      ev(7, 10_000, "action_result", {
        action_ref: "share_button",
        attempt_id: "share_2",
        result: "cancelled",
      }),
      ev(8, 12_000, "help_request", { target_ref: "help_dialog" }),
      ev(9, 15_000, "navigation", { route_template: "/menu/main" }),
      ev(10, 16_000, "progress", { progress_ref: "export_dialog_opened" }),
      ev(11, 16_000, "action_attempt", { action_ref: "export_image", attempt_id: "attempt_1" }),
      ev(12, 18_000, "action_result", {
        action_ref: "export_image",
        attempt_id: "attempt_1",
        result: "success",
      }),
      ev(13, 18_000, "completion", { progress_ref: "image_exported" }),
    ]);
    expect(m).toMatchObject({
      durationMs: 18_000,
      events: 14,
      attempts: 3,
      detours: 2,
      failures: 0,
      helpRequests: 1,
      navigations: 3,
      outcome: "completed",
      timeToGoalMs: 18_000,
      firstDetourMs: 4000,
      distinctActions: ["share_button", "export_image"],
    });
  });

  it("reports an exit as abandoned and an open journey as in progress", () => {
    expect(journeyMetrics([ev(0, 0, "journey_start"), ev(1, 500, "exit")]).outcome).toBe(
      "abandoned",
    );
    expect(journeyMetrics([ev(0, 0, "journey_start"), ev(1, 500, "progress")]).outcome).toBe(
      "in_progress",
    );
    const failed = journeyMetrics([
      ev(0, 0, "journey_start"),
      ev(1, 1, "action_attempt", { action_ref: "x", attempt_id: "a" }),
      ev(2, 2, "action_result", { action_ref: "x", attempt_id: "a", result: "failed" }),
    ]);
    expect(failed.failures).toBe(1);
    expect(failed.detours).toBe(0);
  });
});
