import { z } from "zod";
import { sessionManifestSchema, storedClientEventSchema, transcriptSegmentSchema } from "./session";
import { studyPlanSchema } from "./studyPlan";

export const MAX_EVIDENCE_EVENTS = 400;
export const MAX_EVIDENCE_SEGMENTS = 200;

export const evidencePackageSchema = z.object({
  schema_version: z.literal("1.0"),
  evidence_package_id: z.string().min(1),
  session_id: z.string().min(1),
  study_id: z.string().min(1),
  study_revision: z.number().int().positive(),
  baseline_commit_sha: z.string().min(1),
  task: studyPlanSchema.shape.task.pick({
    task_id: true,
    participant_prompt: true,
    research_question: true,
    success_rule_ref: true,
    time_limit_seconds: true,
  }),
  outcome: sessionManifestSchema.shape.outcome,
  completeness: sessionManifestSchema.shape.completeness,
  instrumentation: sessionManifestSchema.shape.instrumentation,
  session_duration_ms: z.number().int().nonnegative(),
  events: z.array(storedClientEventSchema).max(MAX_EVIDENCE_EVENTS),
  events_truncated: z.boolean(),
  transcript: z.array(transcriptSegmentSchema).max(MAX_EVIDENCE_SEGMENTS),
  transcript_truncated: z.boolean(),
  media: z.array(
    z.object({
      kind: z.enum(["screen_audio", "screen", "audio"]),
      asset_ref: z.string().min(1),
      status: z.enum(["pending", "recording", "uploaded", "verified", "failed", "missing"]),
      duration_ms: z.number().int().nonnegative().nullable().optional(),
    }),
  ),
  provenance: z.enum(["human_session", "simulated_session", "fixture"]),
});

export type EvidencePackage = z.infer<typeof evidencePackageSchema>;
