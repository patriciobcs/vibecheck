import { z } from "zod";
import { UtcTimestampSchema } from "./envelope";

export const ParticipationKindSchema = z.enum([
  "invited",
  "accepted",
  "dismissed",
  "started",
  "completed",
  "abandoned",
]);

export const ParticipationEventSchema = z
  .object({
    schema_version: z.literal("1.0"),
    event_id: z.string().min(1),
    study_id: z.string().min(1),
    study_revision: z.number().int().positive(),
    participant_ref: z.string().min(1),
    kind: ParticipationKindSchema,
    occurred_at: UtcTimestampSchema,
    session_id: z.string().min(1).nullable(),
  })
  .check((event) => {
    if (
      ["started", "completed", "abandoned"].includes(event.value.kind) &&
      !event.value.session_id
    ) {
      event.issues.push({
        code: "custom",
        input: event.value.session_id,
        path: ["session_id"],
        message: "session_id is required for session participation events",
      });
    }
  });

export const ParticipationRecordedPayloadSchema = z.object({
  study_id: z.string().min(1),
  study_revision: z.number().int().positive(),
  participant_ref: z.string().min(1),
  kind: ParticipationKindSchema,
});

export type ParticipationEvent = z.infer<typeof ParticipationEventSchema>;
export type ParticipationKind = z.infer<typeof ParticipationKindSchema>;
