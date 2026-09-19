import { z } from "zod";

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
