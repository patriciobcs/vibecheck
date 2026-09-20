import { z } from "zod";
import { OBSERVATION_EVENT_TYPES, SafeRef } from "./observation";

/** Keys the SDK may report. Typed characters are never allowed (VC-02 keyboard: semantic only). */
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

export const ClientEventTypeSchema = z.enum([
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
  /** Host-app semantic event (`VibeCheck.track`) during a study: allowlisted refs, no content. */
  "semantic",
]);

const ViewportSchema = z.object({
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
});
const CoordinatesSchema = z.object({ x: z.number(), y: z.number() });

const BaseEvent = z.object({
  session_id: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  t_ms: z.number().int().nonnegative(),
  type: ClientEventTypeSchema,
  safe_target_ref: z.string().max(200).optional(),
  viewport: ViewportSchema.optional(),
  coordinates: CoordinatesSchema.optional(),
  /** Scrubbed URL path for navigation events; never includes query secrets. */
  path: z.string().max(2000).optional(),
  key: z.enum(SEMANTIC_KEYS).optional(),
  /** For edit_count: number of edits in a field since last report. */
  count: z.number().int().nonnegative().optional(),
  /** For task_marker / moderation_prompt: a short controlled label. */
  label: z
    .enum(["pause", "resume", "stuck", "finished_early", "withdraw", "what_are_you_looking_for"])
    .optional(),
  /** For semantic: the same allowlisted vocabulary as passive observation. */
  semantic_type: z.enum(OBSERVATION_EVENT_TYPES).optional(),
  journey_id: SafeRef.optional(),
  action_ref: SafeRef.optional(),
  progress_ref: SafeRef.optional(),
  target_ref: SafeRef.optional(),
  result: z.enum(["success", "failed", "validation_failed", "cancelled"]).optional(),
  error_code: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Z0-9_]+$/)
    .optional(),
});

/** Strict: any extra field (text, value, clipboard…) is rejected so content can never leak in. */
export const ClientEventSchema = BaseEvent.strict().superRefine((ev, ctx) => {
  if (ev.type === "keydown" && !ev.key) {
    ctx.addIssue({ code: "custom", message: "keydown requires a semantic key", path: ["key"] });
  }
  if (ev.type === "semantic" && !ev.semantic_type) {
    ctx.addIssue({
      code: "custom",
      message: "semantic requires a semantic_type",
      path: ["semantic_type"],
    });
  }
});

export type ClientEvent = z.infer<typeof ClientEventSchema>;

export const ClientEventBatchSchema = z.object({
  session_id: z.string().min(1),
  batch_sequence: z.number().int().nonnegative(),
  events: z.array(ClientEventSchema).max(500),
});

export type ClientEventBatch = z.infer<typeof ClientEventBatchSchema>;

export const TranscriptSegmentSchema = z
  .object({
    segment_id: z.string().min(1),
    start_ms: z.number().int().nonnegative(),
    end_ms: z.number().int().nonnegative(),
    speaker: z.enum(["participant", "moderator", "unknown"]),
    text: z.string(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .refine((s) => s.end_ms >= s.start_ms, {
    message: "end_ms must be >= start_ms",
    path: ["end_ms"],
  });

export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

export const AssetKindSchema = z.enum(["screen_audio", "screen", "audio"]);
export const AssetStatusSchema = z.enum([
  "pending",
  "recording",
  "uploaded",
  "verified",
  "failed",
  "missing",
]);

export const SessionAssetSchema = z.object({
  kind: AssetKindSchema,
  asset_ref: z.string().min(1),
  status: AssetStatusSchema,
  duration_ms: z.number().int().nonnegative().nullable().optional(),
});

export const SessionManifestSchema = z.object({
  schema_version: z.literal("1.0"),
  session_id: z.string().min(1),
  assignment_id: z.string().min(1),
  study_revision: z.number().int().positive(),
  tested_commit_sha: z.string().regex(/^[0-9a-f]{40}$/),
  consent_version: z.string().min(1),
  capture_policy_ref: z.string().min(1),
  assets: z.array(SessionAssetSchema),
  events_ref: z.string().nullable(),
  transcript_ref: z.string().nullable(),
  clock_map_ref: z.string().nullable(),
  completeness: z.enum(["complete", "partial", "incomplete"]),
  instrumentation: z.enum(["sdk", "video_only"]),
  outcome: z.object({
    participant_reported: z.enum(["completed", "stuck", "gave_up", "withdrew", "unknown"]),
    instrumented: z.enum(["completed", "not_completed", "unknown"]),
  }),
});

export type SessionManifest = z.infer<typeof SessionManifestSchema>;
