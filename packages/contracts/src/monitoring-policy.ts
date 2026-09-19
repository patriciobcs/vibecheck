import { z } from "zod";

/** Proposed starting policy from the spec index: configurable tuning parameters, not validated thresholds. */
export const MonitoringPolicySchema = z.object({
  schema_version: z.literal("1.0"),
  policy_id: z.string().min(1),
  enabled: z.boolean().default(false),
  batch_delay_ms: z.number().int().nonnegative().default(4000),
  window_ms: z.number().int().positive().default(90_000),
  cooldown_ms: z.number().int().nonnegative().default(30_000),
  normal_journey_sample_rate: z.number().min(0).max(1).default(0.01),
  max_evaluations_per_session_hour: z.number().int().nonnegative().default(10),
  max_evaluations_per_product_day: z.number().int().nonnegative().default(1000),
  max_input_tokens: z.number().int().positive().default(6000),
  max_output_tokens_budget: z.number().int().positive().default(1000),
  daily_spend_cap_usd: z.number().nonnegative().default(5),
  candidate_friction_threshold: z.number().min(0).max(1).default(0.85),
  candidate_research_threshold: z.number().min(0).max(1).default(0.8),
  raw_event_retention_days: z.number().int().positive().default(7),
  derived_retention_days: z.number().int().positive().default(30),
  /** Journeys the owner allows collection for; empty means none. */
  allowed_journeys: z.array(z.string()).default([]),
});
export type MonitoringPolicy = z.infer<typeof MonitoringPolicySchema>;

export const DEFAULT_MONITORING_POLICY = (policyId: string): MonitoringPolicy =>
  MonitoringPolicySchema.parse({ schema_version: "1.0", policy_id: policyId });
