import { createHash } from "node:crypto";

export type JourneyEvent = {
  id: string;
  sequence: number;
  t_ms: number;
  type: string;
  payload: Record<string, unknown>;
};

export type TriggerReason =
  | "repeated_failure"
  | "navigation_loop"
  | "help_request"
  | "possible_stall"
  | "journey_end"
  | "normal_sample";
export type Trigger = {
  reason: TriggerReason;
  outcome?: "completed" | "exited" | "unknown";
  evidenceEventIds: string[];
};

export type TriggerPolicy = { window_ms: number; normal_journey_sample_rate: number };
export type TriggerContext = {
  nowMs: number;
  policy: TriggerPolicy;
  journeyInstanceId: string;
  visible?: boolean;
};

const REPEATED_FAILURE_MS = 30_000;
const STALL_MS = 60_000;
const RECENT_INTERACTION_MS = 30_000;
const JOURNEY_TIMEOUT_MS = 5 * 60_000;
const PROGRESS_TYPES = new Set(["progress", "completion"]);
const INTERACTION_TYPES = new Set([
  "action_attempt",
  "action_result",
  "navigation",
  "help_request",
  "progress",
]);

const str = (v: unknown) => (typeof v === "string" ? v : null);

/** Stable 0..1 hash so normal sampling is reproducible per journey instance. */
export function stableFraction(key: string): number {
  const hex = createHash("sha256").update(key).digest("hex").slice(0, 8);
  return Number.parseInt(hex, 16) / 0xffffffff;
}

/**
 * Deterministic trigger policy (VC-03 "Trigger policy"). Pure: the same events, clock and policy
 * always yield the same decisions. Raw pointer/keyboard activity never appears here at all.
 */
export function evaluateTriggers(events: JourneyEvent[], ctx: TriggerContext): Trigger[] {
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  const triggers: Trigger[] = [];
  const last = sorted.at(-1);
  if (!last) return triggers;

  // Repeated failure: two distinct attempts of the same action failing within 30 s.
  const failures = sorted.filter(
    (e) =>
      e.type === "action_result" &&
      (e.payload.result === "failed" || e.payload.result === "validation_failed"),
  );
  const byAction = new Map<string, JourneyEvent[]>();
  for (const f of failures) {
    const action = str(f.payload.action_ref) ?? "unknown";
    const list = byAction.get(action) ?? [];
    if (!list.some((x) => str(x.payload.attempt_id) === str(f.payload.attempt_id))) list.push(f);
    byAction.set(action, list);
  }
  for (const list of byAction.values()) {
    for (let i = 1; i < list.length; i += 1) {
      const a = list[i - 1];
      const b = list[i];
      if (a && b && b.t_ms - a.t_ms <= REPEATED_FAILURE_MS) {
        triggers.push({ reason: "repeated_failure", evidenceEventIds: [a.id, b.id] });
        break;
      }
    }
  }

  // Navigation loop: A→B→A→B within window with no instrumented progress in between.
  const navs = sorted.filter((e) => e.type === "navigation" && str(e.payload.route_template));
  for (let i = 3; i < navs.length; i += 1) {
    const [n0, n1, n2, n3] = [navs[i - 3], navs[i - 2], navs[i - 1], navs[i]];
    if (!n0 || !n1 || !n2 || !n3) continue;
    const r = (n: JourneyEvent) => str(n.payload.route_template);
    const looped =
      r(n0) === r(n2) &&
      r(n1) === r(n3) &&
      r(n0) !== r(n1) &&
      n3.t_ms - n0.t_ms <= ctx.policy.window_ms;
    const progressBetween = sorted.some(
      (e) => PROGRESS_TYPES.has(e.type) && e.sequence > n0.sequence && e.sequence < n3.sequence,
    );
    if (looped && !progressBetween) {
      triggers.push({ reason: "navigation_loop", evidenceEventIds: [n0.id, n1.id, n2.id, n3.id] });
      break;
    }
  }

  const help = sorted.find((e) => e.type === "help_request");
  if (help) triggers.push({ reason: "help_request", evidenceEventIds: [help.id] });

  // Possible stall: only when progress instrumentation exists, the tab is visible, and the user interacted recently.
  const hasProgressInstrumentation = sorted.some((e) => e.type === "progress");
  const lastProgress = [...sorted].reverse().find((e) => PROGRESS_TYPES.has(e.type));
  const lastInteraction = [...sorted].reverse().find((e) => INTERACTION_TYPES.has(e.type));
  const visible =
    ctx.visible ?? sorted.filter((e) => e.type === "visibility").at(-1)?.payload.visible !== false;
  const ended = sorted.some((e) => e.type === "completion" || e.type === "exit");
  if (
    hasProgressInstrumentation &&
    !ended &&
    visible &&
    lastProgress &&
    ctx.nowMs - lastProgress.t_ms >= STALL_MS &&
    lastInteraction &&
    ctx.nowMs - lastInteraction.t_ms <= RECENT_INTERACTION_MS
  ) {
    triggers.push({
      reason: "possible_stall",
      evidenceEventIds: [lastProgress.id, lastInteraction.id],
    });
  }

  // Journey end: completion, explicit exit, or 5 minutes of silence (unknown outcome).
  const completion = sorted.find((e) => e.type === "completion");
  const exit = sorted.find((e) => e.type === "exit");
  if (completion)
    triggers.push({
      reason: "journey_end",
      outcome: "completed",
      evidenceEventIds: [completion.id],
    });
  else if (exit)
    triggers.push({ reason: "journey_end", outcome: "exited", evidenceEventIds: [exit.id] });
  else if (ctx.nowMs - last.t_ms >= JOURNEY_TIMEOUT_MS)
    triggers.push({ reason: "journey_end", outcome: "unknown", evidenceEventIds: [last.id] });

  // Normal sample: stable selection of otherwise untriggered journey ends for blind-spot measurement.
  const endedNow = triggers.some((t) => t.reason === "journey_end");
  const otherwiseTriggered = triggers.some((t) => t.reason !== "journey_end");
  if (
    endedNow &&
    !otherwiseTriggered &&
    stableFraction(ctx.journeyInstanceId) < ctx.policy.normal_journey_sample_rate
  ) {
    triggers.push({ reason: "normal_sample", evidenceEventIds: [last.id] });
  }
  return triggers;
}
