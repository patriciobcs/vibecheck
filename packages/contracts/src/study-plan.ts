import { z } from "zod";

export const CaptureLevelSchema = z.enum(["off", "optional", "required"]);
export const ToggleSchema = z.enum(["off", "on"]);
export const RecruitmentSourceSchema = z.enum(["direct_link", "embedded", "marketplace"]);
export const AutomationModeSchema = z.enum(["issues_only", "draft_pr", "prototype_and_retest"]);
export const CohortSchema = z.enum(["fresh", "repeat"]);

/** Capture policy snapshotted into each published study. MVP forbids text value capture. */
export const CapturePolicySchema = z.object({
  screen: CaptureLevelSchema,
  microphone: CaptureLevelSchema,
  webcam: CaptureLevelSchema,
  pointer: ToggleSchema,
  keyboard: z.enum(["off", "semantic_only"]),
  text_values: z.literal("off"),
  retention_days: z.number().int().positive(),
});

export const StudyTaskSchema = z.object({
  task_id: z.string().min(1),
  participant_prompt: z.string().min(1),
  research_question: z.string().min(1),
  time_limit_seconds: z.number().int().positive(),
  success_rule_ref: z.string().min(1),
  fixture_ref: z.string().min(1),
  scenario: z
    .object({
      intro: z.string().min(1).max(400),
      steps: z
        .array(
          z.object({
            order: z.number().int().positive(),
            instruction: z.string().min(1).max(300),
          }),
        )
        .min(1)
        .max(7),
      think_aloud_cues: z.array(z.string().min(1).max(200)).max(5),
      estimated_minutes: z.number().int().positive().max(60),
    })
    .optional(),
});

export const StudyPlanSchema = z.object({
  schema_version: z.literal("1.0"),
  study_id: z.string().min(1),
  study_revision: z.number().int().positive(),
  product_id: z.string().min(1),
  task: StudyTaskSchema,
  baseline: z.object({
    commit_sha: z.string().regex(/^[0-9a-f]{40}$/, "expected a full git SHA"),
    environment_ref: z.string().min(1),
  }),
  recruitment: z.object({
    source: RecruitmentSourceSchema,
    target_count: z.number().int().positive(),
    cohort: CohortSchema,
    eligibility_rule_ref: z.string().min(1),
  }),
  capture: CapturePolicySchema,
  automation: z.object({
    mode: AutomationModeSchema,
    max_variants: z.number().int().nonnegative(),
    max_repair_attempts: z.number().int().nonnegative(),
    agent_budget_ref: z.string().min(1),
    retest_target_count: z.number().int().nonnegative(),
  }),
});

export type StudyPlan = z.infer<typeof StudyPlanSchema>;
export type CapturePolicy = z.infer<typeof CapturePolicySchema>;
export type RecruitmentSource = z.infer<typeof RecruitmentSourceSchema>;
