import { z } from "zod";

/* ---------------- Questions (request) ---------------- */

export const JevNoulQuestionSchema = z.object({
  type: z.literal("noul"),
  instructions: z.string().min(1),
  criteria: z.object({ true: z.string(), false: z.string() }).optional(),
});
export const JevChoiceQuestionSchema = z.object({
  type: z.literal("choice"),
  instructions: z.string().min(1),
  criteria: z
    .record(z.string(), z.string())
    .refine((c) => Object.keys(c).length >= 2, "choice needs at least two options"),
});
export const JevScoreQuestionSchema = z.object({
  type: z.literal("score"),
  instructions: z.string().min(1),
  criteria: z.array(z.string()).min(2),
});
export const JevQuestionSchema = z.discriminatedUnion("type", [
  JevNoulQuestionSchema,
  JevChoiceQuestionSchema,
  JevScoreQuestionSchema,
]);
export const JevQuestionsSchema = z.record(
  z.string().regex(/^[a-z][a-z0-9_]*$/),
  JevQuestionSchema,
);
export type JevQuestion = z.infer<typeof JevQuestionSchema>;
export type JevQuestions = z.infer<typeof JevQuestionsSchema>;

export const JevRequestSchema = z.object({
  model: z.string().min(1),
  state: z.union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())]),
  questions: JevQuestionsSchema,
});
export type JevRequest = z.infer<typeof JevRequestSchema>;

/* ---------------- Answers (response) ---------------- */

const Probabilities = z.record(z.string(), z.number().min(0).max(1));
export const JevAnswerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) }),
  z.object({
    type: z.literal("choice"),
    choice: z.string(),
    confidence: z.number().min(0).max(1),
    probabilities: Probabilities.optional(),
  }),
  z.object({
    type: z.literal("score"),
    score: z.number(),
    confidence: z.number().min(0).max(1),
    probabilities: Probabilities.optional(),
    legend: z.record(z.string(), z.unknown()).optional(),
  }),
]);
export type JevAnswer = z.infer<typeof JevAnswerSchema>;

export const JevResponseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), JevAnswerSchema),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
    })
    .optional(),
  request_id: z.string().optional(),
});
export type JevResponse = z.infer<typeof JevResponseSchema>;

/**
 * Answers must match the detector's questions exactly: same keys, same types, finite values in
 * bounds, choices among the supplied criteria. A mismatch fails the evaluation; it never defaults.
 */
export function validateAnswersAgainstQuestions(
  questions: JevQuestions,
  rawAnswers: unknown,
): string[] {
  const problems: string[] = [];
  if (!rawAnswers || typeof rawAnswers !== "object") return ["answers: not an object"];
  const answers = rawAnswers as Record<string, unknown>;
  for (const [key, q] of Object.entries(questions)) {
    const parsed = JevAnswerSchema.safeParse(answers[key]);
    if (!(key in answers)) {
      problems.push(`${key}: missing`);
      continue;
    }
    if (!parsed.success) {
      problems.push(`${key}: ${parsed.error.issues.map((i) => i.message).join(", ")}`);
      continue;
    }
    const a = parsed.data;
    if (a.type !== q.type) {
      problems.push(`${key}: expected ${q.type}, got ${a.type}`);
      continue;
    }
    if (a.type === "choice" && q.type === "choice" && !(a.choice in q.criteria))
      problems.push(`${key}: choice "${a.choice}" not among criteria`);
    if (a.type === "score" && !Number.isFinite(a.score)) problems.push(`${key}: score not finite`);
  }
  return problems;
}
