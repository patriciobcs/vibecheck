import { z } from "zod";

export const studyPlanSchema = z.object({
  schema_version: z.literal("1.0"),
  study_id: z.string(),
  study_revision: z.number().int().positive(),
  product_id: z.string(),
  task: z.object({
    task_id: z.string(),
    participant_prompt: z.string().min(1),
    research_question: z.string().min(1),
    time_limit_seconds: z.number().int().positive(),
    success_rule_ref: z.string().min(1),
    fixture_ref: z.string().min(1),
  }),
  baseline: z.object({ commit_sha: z.string().min(1), environment_ref: z.string().min(1) }),
  recruitment: z.object({
    source: z.enum(["direct_link", "embedded", "marketplace"]),
    target_count: z.number().int().positive(),
    cohort: z.string().min(1),
    eligibility_rule_ref: z.string().min(1),
  }),
  capture: z.object({
    screen: z.enum(["required", "optional", "off"]),
    microphone: z.enum(["required", "optional", "off"]),
    webcam: z.enum(["required", "optional", "off"]),
    pointer: z.enum(["on", "off"]),
    keyboard: z.enum(["semantic_only", "off", "on"]),
    text_values: z.enum(["off", "on"]),
    retention_days: z.number().int().positive(),
  }),
  automation: z.object({
    mode: z.enum(["issues_only", "draft_pr", "prototype_and_retest"]),
    max_variants: z.number().int().nonnegative(),
    max_repair_attempts: z.number().int().nonnegative(),
    agent_budget_ref: z.string().min(1),
    retest_target_count: z.number().int().nonnegative(),
  }),
});

export type StudyPlan = z.infer<typeof studyPlanSchema>;
