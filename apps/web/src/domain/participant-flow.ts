/**
 * Participant flow from VC-02:
 * invited → eligible → assigned → consent → device_check → recording → submitting → complete
 * plus the visible non-success outcomes: withdrawn, expired, incomplete.
 */
export const PARTICIPANT_STATES = [
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
] as const;

export type ParticipantState = (typeof PARTICIPANT_STATES)[number];

const FORWARD: Record<ParticipantState, readonly ParticipantState[]> = {
  invited: ["eligible", "expired"],
  eligible: ["assigned", "expired"],
  assigned: ["consent", "withdrawn", "expired"],
  consent: ["device_check", "withdrawn", "expired"],
  device_check: ["recording", "withdrawn", "expired", "incomplete"],
  recording: ["submitting", "withdrawn", "incomplete"],
  submitting: ["complete", "withdrawn", "incomplete"],
  complete: [],
  withdrawn: [],
  expired: [],
  incomplete: [],
};

export const TERMINAL_STATES: readonly ParticipantState[] = [
  "complete",
  "withdrawn",
  "expired",
  "incomplete",
];

export function canTransition(from: ParticipantState, to: ParticipantState): boolean {
  return FORWARD[from].includes(to);
}

export type TransitionResult =
  | { ok: true; state: ParticipantState }
  | { ok: false; reason: "invalid_transition" };

export function transition(from: ParticipantState, to: ParticipantState): TransitionResult {
  return canTransition(from, to)
    ? { ok: true, state: to }
    : { ok: false, reason: "invalid_transition" };
}
