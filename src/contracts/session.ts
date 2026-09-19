import { z } from "zod";

export const SEMANTIC_KEYS = [
  "Tab",
  "Enter",
  "Escape",
  "Backspace",
  "Delete",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
] as const;

export const clientEventTypeSchema = z.enum([
  "pointer_move",
  "click",
  "scroll",
  "navigation",
  "focus",
  "blur",
  "visibility",
  "keydown",
  "edit_count",
  "task_marker",
  "moderation_prompt",
]);

const clientEventBaseSchema = z.object({
  session_id: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  t_ms: z.number().int().nonnegative(),
  type: clientEventTypeSchema,
  safe_target_ref: z.string().max(200).optional(),
  viewport: z
    .object({ width: z.number().int().nonnegative(), height: z.number().int().nonnegative() })
    .optional(),
  coordinates: z.object({ x: z.number(), y: z.number() }).optional(),
  path: z.string().max(2000).optional(),
  key: z.enum(SEMANTIC_KEYS).optional(),
  count: z.number().int().nonnegative().optional(),
  label: z
    .enum(["pause", "resume", "stuck", "finished_early", "withdraw", "what_are_you_looking_for"])
    .optional(),
});

const validateClientEvent = (
  event: z.infer<typeof clientEventBaseSchema>,
  context: z.RefinementCtx,
) => {
  if (event.type === "keydown" && !event.key) {
    context.addIssue({ code: "custom", message: "keydown requires a semantic key", path: ["key"] });
  }
};

export const clientEventSchema = clientEventBaseSchema.strict().superRefine(validateClientEvent);

export const storedClientEventSchema = clientEventBaseSchema
  .extend({
    event_id: z.string().min(1),
  })
  .strict()
  .superRefine(validateClientEvent);

export const transcriptSegmentSchema = z
  .object({
    segment_id: z.string().min(1),
    start_ms: z.number().int().nonnegative(),
    end_ms: z.number().int().nonnegative(),
    speaker: z.enum(["participant", "moderator", "unknown"]),
    text: z.string(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .refine((segment) => segment.end_ms >= segment.start_ms, {
    message: "end_ms must be >= start_ms",
    path: ["end_ms"],
  });

export const sessionAssetSchema = z.object({
  kind: z.enum(["screen_audio", "screen", "audio"]),
  asset_ref: z.string().min(1),
  status: z.enum(["pending", "recording", "uploaded", "verified", "failed", "missing"]),
  duration_ms: z.number().int().nonnegative().nullable().optional(),
});

export const sessionManifestSchema = z.object({
  schema_version: z.literal("1.0"),
  session_id: z.string().min(1),
  assignment_id: z.string().min(1),
  study_revision: z.number().int().positive(),
  tested_commit_sha: z.string().regex(/^[0-9a-f]{40}$/),
  consent_version: z.string().min(1),
  capture_policy_ref: z.string().min(1),
  assets: z.array(sessionAssetSchema),
  events_ref: z.string().nullable(),
  transcript_ref: z.string().nullable(),
  clock_map_ref: z.string().nullable(),
  completeness: z.enum(["complete", "partial", "incomplete"]),
  instrumentation: z.enum(["sdk", "video_only"]),
  outcome: z.object({
    participant_reported: z.enum(["completed", "stuck", "gave_up", "withdrew", "unknown"]),
    instrumented: z.enum(["completed", "not_completed", "unknown"]),
  }),
  provenance: z.literal("fixture").optional(),
});

export const clockMapSchema = z.object({
  schema_version: z.literal("1.0"),
  session_started_at: z.string().datetime(),
  media: z.array(
    z.object({
      asset_ref: z.string().min(1),
      session_offset_ms: z.number().int().nonnegative(),
      duration_ms: z.number().int().nonnegative().nullable(),
    }),
  ),
  pauses: z.array(
    z.object({
      start_ms: z.number().int().nonnegative(),
      end_ms: z.number().int().nonnegative().nullable(),
    }),
  ),
});

export type SessionManifest = z.infer<typeof sessionManifestSchema>;
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;
export type ClientEvent = z.infer<typeof clientEventSchema>;
export type StoredClientEvent = z.infer<typeof storedClientEventSchema>;
export type ClockMap = z.infer<typeof clockMapSchema>;
