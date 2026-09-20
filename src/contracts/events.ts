import { z } from "zod";

export const EVENT_TYPES = [
  "discovery.completed",
  "study.published",
  "assignment.claimed",
  "session.upload_verified",
  "session.analysis_ready",
  "analysis.completed",
  "participation.recorded",
  "summary.generated",
  "issue.created",
  "issue.updated",
  "finding.ready_for_repair",
  "repair.candidate_ready",
  "repair.draft_pr_ready",
  "checks.completed",
  "preview.ready",
  "retest.requested",
  "validation.updated",
  "workflow.blocked",
] as const;

export const studyPublishedPayloadSchema = z.object({
  study_id: z.string(),
  study_revision: z.number().int().positive(),
  plan_ref: z.string(),
});

export const participationRecordedPayloadSchema = z.object({
  study_id: z.string().min(1),
  study_revision: z.number().int().positive(),
  participant_ref: z.string().min(1),
  kind: z.enum(["invited", "accepted", "dismissed", "started", "completed", "abandoned"]),
});

export const summaryGeneratedPayloadSchema = z.object({
  study_id: z.string().min(1),
  study_revision: z.number().int().positive(),
  summary_id: z.string().min(1),
  revision: z.number().int().positive(),
  status: z.enum(["collecting", "summarized", "insufficient_data", "failed"]),
});

export const repairCandidateReadyPayload = z.object({
  repair_run_id: z.string().min(1),
  finding_id: z.string().min(1),
  candidate_commit_sha: z.string().min(1),
});

export const checksCompletedPayload = z.object({
  repair_run_id: z.string().min(1),
  finding_id: z.string().min(1),
  check_run_id: z.string().min(1),
  commit_sha: z.string().min(1),
});

export const previewReadyPayload = z.object({
  repair_run_id: z.string().min(1),
  finding_id: z.string().min(1),
  candidate_commit_sha: z.string().min(1),
  preview_url: z.string().url(),
  fixture_ref: z.string().min(1),
  study_id: z.string().min(1),
  study_revision: z.number().int().positive(),
});

export const workflowBlockedPayload = z.object({
  repair_run_id: z.string().min(1),
  reason: z.string().min(1),
});

export const eventEnvelopeSchema = z.object({
  event_id: z.string(),
  event_type: z.enum(EVENT_TYPES),
  occurred_at: z.string().datetime(),
  tenant_id: z.string(),
  product_id: z.string(),
  correlation_id: z.string(),
  payload: z.record(z.unknown()),
});

export type StudyPublishedPayload = z.infer<typeof studyPublishedPayloadSchema>;
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
