import { z } from "zod";
import { StudyPlanSchema } from "./study-plan";

/** Owner publish request (VC-01 → StudyPlan). Everything not given falls back to product defaults. */
export const PublishInputSchema = z.object({
  product_id: z.string().min(1),
  discovery_run_id: z.string().min(1),
  task_id: z.string().min(1),
  task: StudyPlanSchema.shape.task
    .pick({ participant_prompt: true, time_limit_seconds: true })
    .partial()
    .optional(),
  baseline: StudyPlanSchema.shape.baseline,
  fixture_ref: z.string().min(1),
  recruitment: StudyPlanSchema.shape.recruitment.partial().optional(),
  capture: StudyPlanSchema.shape.capture.partial().optional(),
  automation: StudyPlanSchema.shape.automation.partial().optional(),
});

export type PublishInput = z.infer<typeof PublishInputSchema>;
