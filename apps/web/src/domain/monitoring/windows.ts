import { createHash } from "node:crypto";
import type { JourneyEvent } from "./triggers";

export type WindowInput = {
  journeyInstanceId: string;
  observationSessionId: string;
  journeyId: string;
  buildRef: string;
  detectorRef: string;
  policyRef: string;
  requiredEvents: string[];
  windowMs: number;
  maxInputChars: number;
  nowMs: number;
  triggerReason: string;
  goalSource?: "declared" | "inferred" | "unknown";
  droppedEvents?: number;
};

export type BuiltWindow = {
  startMs: number;
  endMs: number;
  eventIds: string[];
  gaps: { after_sequence: number; missing: number }[];
  coverage: { required: string[]; observed: string[]; missing: string[]; dropped_events: number };
  goalSource: "declared" | "inferred" | "unknown";
  priorProgressSummary: {
    events: number;
    last_progress_ref: string | null;
    last_progress_t_ms: number | null;
    types: Record<string, number>;
  } | null;
  omitted: number;
  contentHash: string;
  /** Redacted state handed to Jev: ordered semantic events only. */
  state: Record<string, unknown>;
};

const TERMINAL = new Set([
  "completion",
  "exit",
  "help_request",
  "action_result",
  "validation_error",
]);

/**
 * Builds the bounded ObservationWindow for one journey: the last `windowMs` of events plus a compact
 * summary of earlier progress, coverage against the detector's required events, sequence gaps, and a
 * content hash for deduplication. Truncation to the input budget keeps terminal outcomes and records
 * how many events were omitted. No fabricated context.
 */
export function buildWindow(events: JourneyEvent[], input: WindowInput): BuiltWindow {
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  const endMs = input.nowMs;
  const startMs = Math.max(0, endMs - input.windowMs);
  const inWindow = sorted.filter((e) => e.t_ms >= startMs);
  const earlier = sorted.filter((e) => e.t_ms < startMs);

  const gaps: BuiltWindow["gaps"] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev && cur && cur.sequence - prev.sequence > 1)
      gaps.push({ after_sequence: prev.sequence, missing: cur.sequence - prev.sequence - 1 });
  }

  const observed = [...new Set(sorted.map((e) => e.type))];
  const coverage = {
    required: input.requiredEvents,
    observed,
    missing: input.requiredEvents.filter((r) => !observed.includes(r)),
    dropped_events: input.droppedEvents ?? 0,
  };

  let priorProgressSummary: BuiltWindow["priorProgressSummary"] = null;
  if (earlier.length > 0) {
    const lastProgress = [...earlier].reverse().find((e) => e.type === "progress");
    const types: Record<string, number> = {};
    for (const e of earlier) types[e.type] = (types[e.type] ?? 0) + 1;
    priorProgressSummary = {
      events: earlier.length,
      last_progress_ref: (lastProgress?.payload.progress_ref as string | undefined) ?? null,
      last_progress_t_ms: lastProgress?.t_ms ?? null,
      types,
    };
  }

  // Truncate to the input budget: drop oldest non-terminal events first.
  const serialize = (list: JourneyEvent[]) =>
    list.map((e) => ({ seq: e.sequence, t_ms: e.t_ms, type: e.type, ...e.payload }));
  const kept = [...inWindow];
  let omitted = 0;
  while (kept.length > 1 && JSON.stringify(serialize(kept)).length > input.maxInputChars) {
    const idx = kept.findIndex((e) => !TERMINAL.has(e.type));
    kept.splice(idx === -1 ? 0 : idx, 1);
    omitted += 1;
  }
  const goalSource =
    input.goalSource ??
    (sorted.some((e) => e.type === "journey_start" && e.payload.goal_source === "declared")
      ? "declared"
      : sorted.some((e) => e.type === "journey_start")
        ? "declared"
        : "unknown");
  const contentHash = createHash("sha256")
    .update(
      JSON.stringify({
        j: input.journeyInstanceId,
        b: input.buildRef,
        e: sorted.map((e) => [e.id, e.sequence, e.t_ms, e.type, e.payload]),
      }),
    )
    .digest("hex");

  const state = {
    journey_id: input.journeyId,
    build_ref: input.buildRef,
    goal_source: goalSource,
    trigger_reason: input.triggerReason,
    window: { start_ms: startMs, end_ms: endMs, omitted_events: omitted },
    coverage,
    gaps,
    prior_progress: priorProgressSummary,
    events: serialize(kept),
  };
  return {
    startMs,
    endMs,
    eventIds: kept.map((e) => e.id),
    gaps,
    coverage,
    goalSource,
    priorProgressSummary,
    omitted,
    contentHash,
    state,
  };
}
