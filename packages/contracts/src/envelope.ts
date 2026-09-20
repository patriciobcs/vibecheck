import { z } from "zod";

/** Event types defined in specs/README.md and specs/06. */
export const EVENT_TYPES = [
  "discovery.completed",
  "study.published",
  "assignment.claimed",
  "session.upload_verified",
  "session.analysis_ready",
  "analysis.completed",
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
  "detector.published",
  "observation.batch_received",
  "evaluation.requested",
  "evaluation.completed",
  "research_candidate.updated",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** UTC ISO-8601 with an explicit Z or offset, e.g. 2026-09-19T10:00:00Z. */
export const UtcTimestampSchema = z.iso.datetime({ offset: true });

export const EventEnvelopeSchema = z.object({
  schema_version: z.literal("1.0"),
  event_id: z.string().min(1),
  event_type: z.enum(EVENT_TYPES),
  occurred_at: UtcTimestampSchema,
  tenant_id: z.string().min(1),
  product_id: z.string().min(1),
  correlation_id: z.string().min(1),
  idempotency_key: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

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
  preview_url: z.url(),
  fixture_ref: z.string().min(1),
  study_id: z.string().min(1),
  study_revision: z.number().int().positive(),
});

export const workflowBlockedPayload = z.object({
  repair_run_id: z.string().min(1),
  reason: z.string().min(1),
});

export const repairDraftPrReadyPayload = z.object({
  repair_run_id: z.string().min(1),
  finding_id: z.string().min(1),
  pull_request_ref: z.string().min(1),
});
