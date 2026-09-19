import { z } from "zod";

export const studyPublishedPayloadSchema = z.object({
  study_id: z.string(),
  study_revision: z.number().int().positive(),
  plan_ref: z.string(),
});

export const eventEnvelopeSchema = z.object({
  event_id: z.string(),
  event_type: z.string(),
  occurred_at: z.string().datetime(),
  tenant_id: z.string(),
  product_id: z.string(),
  correlation_id: z.string(),
  payload: z.record(z.unknown()),
});

export type StudyPublishedPayload = z.infer<typeof studyPublishedPayloadSchema>;
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
