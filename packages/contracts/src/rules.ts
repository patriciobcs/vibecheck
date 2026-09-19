/**
 * Registered rule identifiers. Discovery output may only reference these; the prompt lists them
 * so an agent cannot substitute prose. Evaluators for success rules live with VC-04/VC-07 checks.
 */
export const SUCCESS_RULE_REFS = [
  "stickynote_capture_v1",
  "fill_match_v1",
  "viewport_reached_v1",
  "drawing_exported_v1",
  "booking_time_changed_v1",
] as const;

export const ELIGIBILITY_RULE_REFS = [
  "eligible_whiteboard_users_v1",
  "any_visitor_v1",
  "eligible_booking_users_v1",
] as const;

export type SuccessRuleRef = (typeof SUCCESS_RULE_REFS)[number];
export type EligibilityRuleRef = (typeof ELIGIBILITY_RULE_REFS)[number];

export const isSuccessRuleRef = (v: string): v is SuccessRuleRef =>
  (SUCCESS_RULE_REFS as readonly string[]).includes(v);
export const isEligibilityRuleRef = (v: string): v is EligibilityRuleRef =>
  (ELIGIBILITY_RULE_REFS as readonly string[]).includes(v);
