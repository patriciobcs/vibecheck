import { z } from "zod";
import { SessionManifestSchema, TranscriptSegmentSchema } from "./session";
import { StudyPlanSchema } from "./study-plan";

export const MAX_EVIDENCE_EVENTS = 400;
export const MAX_EVIDENCE_SEGMENTS = 200;

export const StoredClientEventSchema = z.object({
  event_id: z.string().min(1),
  session_id: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  t_ms: z.number().int().nonnegative(),
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

export const EvidencePackageSchema = z.object({
  schema_version: z.literal("1.0"),
  evidence_package_id: z.string().min(1),
  session_id: z.string().min(1),
  study_id: z.string().min(1),
  study_revision: z.number().int().positive(),
  baseline_commit_sha: z.string().min(1),
  task: StudyPlanSchema.shape.task.pick({
    task_id: true,
    participant_prompt: true,
    research_question: true,
    success_rule_ref: true,
    time_limit_seconds: true,
  }),
  outcome: SessionManifestSchema.shape.outcome,
  completeness: SessionManifestSchema.shape.completeness,
  instrumentation: SessionManifestSchema.shape.instrumentation,
  session_duration_ms: z.number().int().nonnegative(),
  events: z.array(StoredClientEventSchema).max(MAX_EVIDENCE_EVENTS),
  events_truncated: z.boolean(),
  transcript: z.array(TranscriptSegmentSchema).max(MAX_EVIDENCE_SEGMENTS),
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

export type EvidencePackage = z.infer<typeof EvidencePackageSchema>;
