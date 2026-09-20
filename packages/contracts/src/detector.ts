import { z } from "zod";
import { type JevQuestions, JevQuestionsSchema } from "./jev";
import { OBSERVATION_EVENT_TYPES } from "./observation";

export const BASE_DETECTOR_QUESTIONS = [
  "evidence_sufficiency",
  "ux_friction_observed",
  "targeted_research_warranted",
  "problem_category",
] as const;
export const MAX_QUESTIONS = 12;
export const MAX_QUESTION_CHARS = 2000;

/** Immutable detector version (VC-01 authoring, VC-03 evaluation). Questions are Jev-compatible. */
export const DetectorDefinitionSchema = z.object({
  schema_version: z.literal("1.0"),
  detector_id: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/),
  version: z.number().int().positive(),
  journey_id: z.string().min(1),
  app_build_ref: z.string().min(1),
  instrumentation_schema_version: z.string().min(1),
  required_events: z.array(z.enum(OBSERVATION_EVENT_TYPES)).min(1),
  questions: JevQuestionsSchema,
  evaluation_policy_ref: z.string().min(1),
  provenance: z.enum(["manual", "devin", "fixture"]),
  source_refs: z.array(z.string()).default([]),
});
export type DetectorDefinition = z.infer<typeof DetectorDefinitionSchema>;

/** Output shape a generating agent must return; the service adds identity and provenance. */
export const GeneratedDetectorSchema = z.object({
  schema_version: z.literal("1.0"),
  journey_id: z.string().min(1),
  required_events: z.array(z.enum(OBSERVATION_EVENT_TYPES)).min(1),
  /** Events the journey needs but the target does not emit yet. */
  missing_instrumentation: z.array(z.string()).default([]),
  questions: JevQuestionsSchema,
  rationale: z.string().min(1),
});
export type GeneratedDetector = z.infer<typeof GeneratedDetectorSchema>;
export const generatedDetectorJsonSchema = z.toJSONSchema(GeneratedDetectorSchema, {
  reused: "inline",
  io: "input",
});

const DEPENDENCY_PATTERN =
  /\b(if|when|unless|depending on|based on)\b[^.]*\b(answer|question|the previous|above)\b|\b(evidence_sufficiency|ux_friction_observed|targeted_research_warranted|problem_category)\b/i;

/**
 * Publish-time validation beyond the schema: the base questions exist, the category question has
 * `other_or_uncertain`, every instruction stands alone (no dependency on another answer), sizes bounded.
 */
export function validateDetectorQuestions(questions: JevQuestions): string[] {
  const problems: string[] = [];
  for (const key of BASE_DETECTOR_QUESTIONS)
    if (!(key in questions)) problems.push(`missing base question ${key}`);
  const es = questions.evidence_sufficiency;
  if (
    es &&
    (es.type !== "choice" ||
      !["sufficient", "partial", "insufficient"].every((k) => k in es.criteria))
  )
    problems.push("evidence_sufficiency must be a choice with sufficient/partial/insufficient");
  for (const k of ["ux_friction_observed", "targeted_research_warranted"] as const)
    if (questions[k] && questions[k].type !== "noul") problems.push(`${k} must be a noul question`);
  const cat = questions.problem_category;
  if (cat && (cat.type !== "choice" || !("other_or_uncertain" in cat.criteria)))
    problems.push("problem_category must be a choice including other_or_uncertain");
  if (Object.keys(questions).length > MAX_QUESTIONS)
    problems.push(`size: more than ${MAX_QUESTIONS} questions`);
  for (const [key, q] of Object.entries(questions)) {
    if (JSON.stringify(q).length > MAX_QUESTION_CHARS)
      problems.push(`size: question ${key} exceeds ${MAX_QUESTION_CHARS} characters`);
    if (
      !BASE_DETECTOR_QUESTIONS.includes(key as (typeof BASE_DETECTOR_QUESTIONS)[number]) &&
      DEPENDENCY_PATTERN.test(q.instructions)
    ) {
      problems.push(
        `question ${key} appears to depend on another answer; instructions must stand alone`,
      );
    }
  }
  return problems;
}
