import { z } from "zod";

/** Allowlisted passive semantic events (VC-02 passive observation mode). No raw input ever. */
export const OBSERVATION_EVENT_TYPES = [
  "journey_start",
  "progress",
  "action_attempt",
  "action_result",
  "validation_error",
  "navigation",
  "help_request",
  "completion",
  "exit",
  "visibility",
] as const;
export type ObservationEventType = (typeof OBSERVATION_EVENT_TYPES)[number];

export const SafeRef = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9_.:\-/[\]]+$/, "safe identifiers only");
/** Route templates: path only, no query/fragment, token-like segments already masked. */
const RouteTemplate = z
  .string()
  .min(1)
  .max(300)
  .regex(/^\/[^?#\s]*$/, "path template without query or fragment");

export const ObservationEventSchema = z
  .object({
    event_id: z.string().min(1).max(64),
    observation_session_id: z.string().min(1),
    journey_instance_id: z.string().min(1),
    journey_id: SafeRef,
    sequence: z.number().int().nonnegative(),
    t_ms: z.number().int().nonnegative(),
    build_ref: z.string().min(1).max(120),
    instrumentation_schema_version: z.string().min(1).max(20),
    collection_policy_ref: z.string().min(1).max(120),
    type: z.enum(OBSERVATION_EVENT_TYPES),
    action_ref: SafeRef.optional(),
    attempt_id: z.string().min(1).max(64).optional(),
    result: z.enum(["success", "failed", "validation_failed", "cancelled"]).optional(),
    error_code: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Z0-9_]+$/)
      .optional(),
    progress_ref: SafeRef.optional(),
    route_template: RouteTemplate.optional(),
    target_ref: SafeRef.optional(),
    /** Client-observed vs server-confirmed outcome for completion events. */
    verification: z.enum(["client_observed", "server_confirmed"]).optional(),
    visible: z.boolean().optional(),
    goal_source: z.enum(["declared", "inferred", "unknown"]).default("unknown"),
  })
  .strict();

export type ObservationEvent = z.infer<typeof ObservationEventSchema>;

export const ObservationBatchSchema = z.object({
  observation_session_id: z.string().min(1),
  batch_id: z.string().min(1).max(64),
  events: z.array(ObservationEventSchema).min(0).max(200),
});
export type ObservationBatch = z.infer<typeof ObservationBatchSchema>;
