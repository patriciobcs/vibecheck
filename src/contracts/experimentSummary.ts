import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { findingCertaintySchema, findingProvenanceSchema } from "./finding";

export const summaryStatusSchema = z.enum([
  "collecting",
  "summarized",
  "insufficient_data",
  "failed",
]);
export const summaryProvenanceSchema = findingProvenanceSchema;
export const summaryExclusionReasonSchema = z.enum([
  "baseline_mismatch",
  "incomplete_capture",
  "analysis_failed",
  "analysis_pending",
]);
export const summaryOutcomeSchema = z.enum([
  "completed",
  "stuck",
  "gave_up",
  "withdrew",
  "unknown",
]);

const issueRefSchema = z
  .object({
    provider: z.literal("github"),
    repo: z.string().min(1),
    number: z.number().int().positive(),
    url: z.string().url(),
  })
  .nullable();

export const experimentThemeSchema = z.object({
  finding_id: z.string().min(1),
  title: z.string().min(1),
  category: z.string().min(1),
  observation: z.string().min(1),
  hypothesis: z.string().min(1),
  observed_session_count: z.number().int().nonnegative(),
  eligible_session_count: z.number().int().nonnegative(),
  certainty: findingCertaintySchema,
  impact: z.string().min(1),
  issue_ref: issueRefSchema,
  repair_status: z.string().nullable(),
});

export const experimentSummarySchema = z.object({
  schema_version: z.literal("1.0"),
  summary_id: z.string().min(1),
  study_id: z.string().min(1),
  study_revision: z.number().int().positive(),
  revision: z.number().int().positive(),
  status: summaryStatusSchema,
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
        reason: summaryExclusionReasonSchema,
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
  themes: z.array(experimentThemeSchema),
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
  provenance: summaryProvenanceSchema,
  inputs_hash: z.string().min(1),
  generated_at: z.string().datetime(),
});

export const summaryNarrativeOutputSchema = z.object({
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

export const summaryNarrativeOutputJsonSchema = zodToJsonSchema(summaryNarrativeOutputSchema, {
  $refStrategy: "none",
});

export type ExperimentSummary = z.infer<typeof experimentSummarySchema>;
export type ExperimentTheme = z.infer<typeof experimentThemeSchema>;
export type SummaryNarrativeOutput = z.infer<typeof summaryNarrativeOutputSchema>;
