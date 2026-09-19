import { z } from "zod";

export const findingCertaintySchema = z.enum([
  "insufficient_evidence",
  "preliminary",
  "repeated_observation",
  "contradictory",
]);
export const findingIssueRefSchema = z
  .object({
    provider: z.literal("github"),
    repo: z.string().min(1),
    number: z.number().int().positive(),
    url: z.string().url(),
  })
  .nullable();
export const findingEvidenceSchema = z.object({
  session_id: z.string().min(1),
  segment_ids: z.array(z.string().min(1)),
  event_ids: z.array(z.string().min(1)),
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().nonnegative(),
});
export const findingSchema = z.object({
  schema_version: z.literal("1.0"),
  finding_id: z.string().min(1),
  study_id: z.string().min(1),
  study_revision: z.number().int().positive(),
  baseline_commit_sha: z.string().min(1),
  category: z.string().min(1),
  semantic_target: z.string().min(1),
  observation: z.string().min(1),
  hypothesis: z.string().min(1),
  evidence: z.array(findingEvidenceSchema),
  observed_session_count: z.number().int().nonnegative(),
  eligible_session_count: z.number().int().nonnegative(),
  impact: z.string().min(1),
  certainty: findingCertaintySchema,
  limitations: z.array(z.string()),
  suggested_experiment: z.string().nullable(),
  fingerprint: z.string().min(1),
  issue_ref: findingIssueRefSchema,
  provenance: z.enum(["human_session", "simulated_session", "fixture"]),
});

export type Finding = z.infer<typeof findingSchema>;
