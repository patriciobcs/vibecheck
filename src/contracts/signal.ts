import { z } from "zod";

export const signalSeveritySchema = z.enum(["low", "medium", "high"]);

export const signalSchema = z
  .object({
    schema_version: z.literal("1.0"),
    signal_id: z.string().min(1),
    source: z.literal("jev"),
    title: z.string().min(3).max(120),
    description: z.string().max(2000),
    severity: signalSeveritySchema,
    semantic_target: z.string().max(80),
    observed_sessions: z.number().int().nonnegative().optional(),
    window_start: z.string().datetime({ offset: true }),
    window_end: z.string().datetime({ offset: true }),
    evidence_ref: z.string().min(1).nullable(),
  })
  .refine(
    (signal) => new Date(signal.window_end).getTime() >= new Date(signal.window_start).getTime(),
    {
      path: ["window_end"],
      message: "window_end must be greater than or equal to window_start",
    },
  );

export type Signal = z.infer<typeof signalSchema>;
