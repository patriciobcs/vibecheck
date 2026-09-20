import { z } from "zod";

export const participationKindSchema = z.enum([
  "invited",
  "accepted",
  "dismissed",
  "started",
  "completed",
  "abandoned",
]);

export const participationEventSchema = z
  .object({
    schema_version: z.literal("1.0"),
    event_id: z.string().min(1),
    study_id: z.string().min(1),
    study_revision: z.number().int().positive(),
    participant_ref: z.string().min(1),
    kind: participationKindSchema,
    occurred_at: z.string().datetime(),
    session_id: z.string().min(1).nullable(),
  })
  .superRefine((event, context) => {
    if (["started", "completed", "abandoned"].includes(event.kind) && !event.session_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["session_id"],
        message: "session_id is required for session participation events",
      });
    }
  });

export type ParticipationEvent = z.infer<typeof participationEventSchema>;
export type ParticipationKind = z.infer<typeof participationKindSchema>;
