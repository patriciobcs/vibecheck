import { z } from "zod";

export const SignalSeveritySchema = z.enum(["low", "medium", "high"]);

/**
 * Inbound flag from the continuous-activity pipeline (Jev, spec-2). A hint, not a finding:
 * it carries no session evidence and never creates issues or repairs by itself (VC-06).
 */
export const SignalSchema = z
  .object({
    schema_version: z.literal("1.0"),
    signal_id: z.string().min(1),
    source: z.literal("jev"),
    title: z.string().min(3).max(120),
    description: z.string().min(1).max(2000),
    severity: SignalSeveritySchema,
    semantic_target: z.string().min(1).max(80),
    observed_sessions: z.array(z.string()).optional(),
    window_start: z.iso.datetime({ offset: true }),
    window_end: z.iso.datetime({ offset: true }),
    evidence_ref: z.string().min(1).nullable(),
  })
  .refine(
    (signal) => new Date(signal.window_end).getTime() >= new Date(signal.window_start).getTime(),
    {
      path: ["window_end"],
      message: "window_end must be greater than or equal to window_start",
    },
  );

export type Signal = z.infer<typeof SignalSchema>;
