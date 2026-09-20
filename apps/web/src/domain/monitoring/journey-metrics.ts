import type { JourneyEvent } from "./triggers";

export type JourneyOutcome = "not_started" | "in_progress" | "completed" | "abandoned";

export type JourneyMetrics = {
  /** First to last event on the journey clock. */
  durationMs: number;
  events: number;
  /** action_attempt events. */
  attempts: number;
  /** Attempts whose result was cancelled: a control that did not lead to the goal. */
  detours: number;
  /** Attempts whose result was failed or validation_failed. */
  failures: number;
  helpRequests: number;
  navigations: number;
  outcome: JourneyOutcome;
  /** journey_start → completion, when completed. */
  timeToGoalMs: number | null;
  /** When the first detour happened, relative to the journey start. */
  firstDetourMs: number | null;
  distinctActions: string[];
};

const str = (v: unknown) => (typeof v === "string" ? v : null);

/**
 * Deterministic journey facts derived from stored semantic events. These are counts and times,
 * never judgments: what the user did and how long it took, before any model looks at it.
 */
export function journeyMetrics(events: JourneyEvent[]): JourneyMetrics {
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last) {
    return {
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
    };
  }
  const start = sorted.find((e) => e.type === "journey_start") ?? first;
  const results = sorted.filter((e) => e.type === "action_result");
  const detourResults = results.filter((e) => e.payload.result === "cancelled");
  const failures = results.filter(
    (e) => e.payload.result === "failed" || e.payload.result === "validation_failed",
  ).length;
  const completion = sorted.find((e) => e.type === "completion");
  const exit = sorted.find((e) => e.type === "exit");
  const outcome: JourneyOutcome = completion ? "completed" : exit ? "abandoned" : "in_progress";
  const actions: string[] = [];
  for (const e of sorted) {
    const ref = str(e.payload.action_ref);
    if (
      (e.type === "action_attempt" || e.type === "action_result") &&
      ref &&
      !actions.includes(ref)
    )
      actions.push(ref);
  }
  // A detour starts when the control was opened (the attempt), not when it was abandoned.
  const firstDetourResult = detourResults[0];
  const firstDetour = firstDetourResult
    ? (sorted.find(
        (e) =>
          e.type === "action_attempt" &&
          str(e.payload.attempt_id) === str(firstDetourResult.payload.attempt_id),
      ) ?? firstDetourResult)
    : undefined;
  return {
    durationMs: last.t_ms - first.t_ms,
    events: sorted.length,
    attempts: sorted.filter((e) => e.type === "action_attempt").length,
    detours: detourResults.length,
    failures,
    helpRequests: sorted.filter((e) => e.type === "help_request").length,
    navigations: sorted.filter((e) => e.type === "navigation").length,
    outcome,
    timeToGoalMs: completion ? completion.t_ms - start.t_ms : null,
    firstDetourMs: firstDetour ? firstDetour.t_ms - start.t_ms : null,
    distinctActions: actions,
  };
}
