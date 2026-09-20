import { z } from "zod";

export const FINDING_CATEGORIES = [
  "discoverability",
  "feedback",
  "navigation",
  "terminology",
  "efficiency",
  "error_recovery",
  "successful_use",
  "other",
] as const;
export const FINDING_IMPACTS = [
  "task_blocked",
  "task_slowed",
  "workaround_used",
  "no_impact",
  "positive",
] as const;
export const MAX_FINDINGS = 5;
export const FINDING_TITLE_MAX = 72;

export const TitleSchema = z
  .string()
  .min(8)
  .max(FINDING_TITLE_MAX)
  .refine((title) => !title.endsWith("."), "title must not end with a period")
  .refine((title) => /[a-z]/.test(title), "title must not be all caps")
  .refine(
    (title) => title.match(/: /g)?.length === 1,
    "title must contain exactly one ': ' separator",
  )
  .refine((title) => {
    const area = title.split(": ", 1)[0]?.trim() ?? "";
    return Boolean(area) && area.split(/\s+/).length <= 3;
  }, "title area must contain 1 to 3 words")
  .refine((title) => Boolean(title.split(": ")[1]?.trim()), "title problem must not be empty");

export const AnalysisEvidenceSchema = z
  .object({
    segment_ids: z.array(z.string().min(1)),
    event_ids: z.array(z.string().min(1)),
    start_ms: z.number().int().nonnegative(),
    end_ms: z.number().int().nonnegative(),
    quote: z.string().optional(),
  })
  .refine((evidence) => evidence.end_ms >= evidence.start_ms, {
    message: "end_ms must be >= start_ms",
    path: ["end_ms"],
  })
  .refine((evidence) => evidence.segment_ids.length + evidence.event_ids.length > 0, {
    message: "at least one segment or event citation is required",
  });

export const AnalysisFindingSchema = z.object({
  title: TitleSchema,
  category: z.enum(FINDING_CATEGORIES),
  semantic_target: z.string().min(1).max(80),
  observation: z.string().min(1),
  hypothesis: z.string().min(1),
  evidence: z.array(AnalysisEvidenceSchema).min(1),
  impact: z.enum(FINDING_IMPACTS),
  limitations: z.array(z.string()),
  suggested_experiment: z.string().optional(),
});

export const AnalysisOutputSchema = z
  .object({
    schema_version: z.literal("1.0"),
    evidence_package_id: z.string().min(1),
    session_id: z.string().min(1),
    outcome: z.enum(["findings", "no_finding", "insufficient_evidence"]).default("findings"),
    outcome_reason: z.string().optional(),
    findings: z.array(AnalysisFindingSchema).max(MAX_FINDINGS),
  })
  .superRefine((output, context) => {
    if (output.outcome !== "findings" && output.findings.length > 0)
      context.addIssue({
        code: "custom",
        message: "findings must be empty unless outcome is findings",
      });
  });

export const AnalysisOutputJsonSchema = z.toJSONSchema(AnalysisOutputSchema, {
  reused: "inline",
  io: "input",
});

export type AnalysisOutput = z.infer<typeof AnalysisOutputSchema>;
export type AnalysisFinding = z.infer<typeof AnalysisFindingSchema>;
