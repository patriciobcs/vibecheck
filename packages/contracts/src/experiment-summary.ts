import { z } from "zod";
import { UtcTimestampSchema } from "./envelope";
import { FindingCertaintySchema, FindingProvenanceSchema } from "./finding";
import { repairStatusSchema } from "./repair-run";

export const SummaryStatusSchema = z.enum([
  "collecting",
  "summarized",
  "insufficient_data",
  "failed",
]);

export const SummaryExclusionReasonSchema = z.enum([
  "baseline_mismatch",
  "incomplete_capture",
  "analysis_failed",
]);

export const SummaryOutcomeSchema = z.enum([
  "completed",
  "stuck",
  "gave_up",
  "withdrew",
  "unknown",
]);

const IssueRefSchema = z
  .object({
    provider: z.literal("github"),
    repo: z.string().min(1),
    number: z.number().int().positive(),
    url: z.url(),
  })
  .nullable();

export const ExperimentThemeSchema = z.object({
  finding_id: z.string().min(1),
  title: z.string().min(1),
  category: z.string().min(1),
  observation: z.string().min(1),
  hypothesis: z.string().min(1),
  observed_session_count: z.number().int().nonnegative(),
  eligible_session_count: z.number().int().nonnegative(),
  certainty: FindingCertaintySchema,
  impact: z.string().min(1),
  issue_ref: IssueRefSchema,
  repair_status: repairStatusSchema.nullable(),
});

const JevScreeningSchema = z.object({
  label: z.literal("passive_signal"),
  source_candidate_refs: z.array(z.string()),
  related_candidates: z.array(
    z.object({
      candidate_id: z.string(),
      category: z.string(),
      target_ref: z.string(),
      distinct_observation_sessions: z.number().int(),
      state: z.string(),
    }),
  ),
});

export const ExperimentSummarySchema = z.object({
  schema_version: z.literal("1.0"),
  summary_id: z.string().min(1),
  study_id: z.string().min(1),
  study_revision: z.number().int().positive(),
  revision: z.number().int().positive(),
  status: SummaryStatusSchema,
  baseline_commit_sha: z.string().min(1),
  participation: z.object({
    invited: z.number().int().nonnegative(),
    accepted: z.number().int().nonnegative(),
    dismissed: z.number().int().nonnegative(),
    started: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    abandoned: z.number().int().nonnegative(),
    unknown: z.boolean(),
  }),
  sessions: z.object({
    eligible: z.number().int().nonnegative(),
    excluded: z.array(
      z.object({
        session_id: z.string().min(1),
        reason: SummaryExclusionReasonSchema,
      }),
    ),
    outcomes: z.object({
      completed: z.number().int().nonnegative(),
      stuck: z.number().int().nonnegative(),
      gave_up: z.number().int().nonnegative(),
      withdrew: z.number().int().nonnegative(),
      unknown: z.number().int().nonnegative(),
    }),
  }),
  themes: z.array(ExperimentThemeSchema),
  jev_screening: JevScreeningSchema.nullable().optional(),
  narrative: z.object({
    headline: z.string(),
    observations: z.array(
      z.object({
        text: z.string(),
        finding_ids: z.array(z.string().min(1)),
      }),
    ),
    limitations: z.array(z.string()),
  }),
  provenance: FindingProvenanceSchema,
  inputs_hash: z.string().min(1),
  generated_at: UtcTimestampSchema,
});

export const SummaryNarrativeOutputSchema = z.object({
  schema_version: z.literal("1.0"),
  study_id: z.string().min(1),
  headline: z.string().min(8).max(120),
  observations: z
    .array(
      z.object({
        text: z.string().max(400),
        finding_ids: z.array(z.string().min(1)).min(1),
      }),
    )
    .min(3)
    .max(5),
  limitations: z.array(z.string()),
});

export const SummaryNarrativeOutputJsonSchema = z.toJSONSchema(SummaryNarrativeOutputSchema, {
  reused: "inline",
  io: "input",
});

export const SummaryGeneratedPayloadSchema = z.object({
  study_id: z.string().min(1),
  study_revision: z.number().int().positive(),
  summary_id: z.string().min(1),
  revision: z.number().int().positive(),
  status: SummaryStatusSchema,
});

export type SummaryStatus = z.infer<typeof SummaryStatusSchema>;
export type ExperimentSummary = z.infer<typeof ExperimentSummarySchema>;
export type ExperimentTheme = z.infer<typeof ExperimentThemeSchema>;
export type SummaryNarrativeOutput = z.infer<typeof SummaryNarrativeOutputSchema>;
