import { describe, expect, it } from "vitest";
import { DetectorDefinitionSchema, validateDetectorQuestions } from "./detector";
import {
  type JevQuestions,
  JevRequestSchema,
  JevResponseSchema,
  validateAnswersAgainstQuestions,
} from "./jev";
import { MonitoringPolicySchema } from "./monitoring-policy";
import { ObservationBatchSchema, ObservationEventSchema } from "./observation";

const baseEvent = {
  event_id: "oev_1",
  observation_session_id: "obs_1",
  journey_instance_id: "journey_1",
  journey_id: "share_drawing",
  sequence: 17,
  t_ms: 43000,
  build_ref: "build_1",
  instrumentation_schema_version: "1.0",
  collection_policy_ref: "collection_policy_1",
  type: "action_result",
  action_ref: "export_image",
  attempt_id: "attempt_1",
  result: "validation_failed",
  error_code: "SLOT_UNAVAILABLE",
  goal_source: "unknown",
};

describe("ObservationEventSchema", () => {
  it("accepts the spec example", () => {
    expect(ObservationEventSchema.parse(baseEvent)).toEqual(baseEvent);
  });
  it("rejects free text and unknown properties", () => {
    expect(ObservationEventSchema.safeParse({ ...baseEvent, text: "hello" }).success).toBe(false);
    expect(ObservationEventSchema.safeParse({ ...baseEvent, input_value: "secret" }).success).toBe(
      false,
    );
  });
  it("rejects unknown event types and raw urls with query strings", () => {
    expect(ObservationEventSchema.safeParse({ ...baseEvent, type: "keypress" }).success).toBe(
      false,
    );
    expect(
      ObservationEventSchema.safeParse({
        ...baseEvent,
        type: "navigation",
        route_template: "/a?token=1",
      }).success,
    ).toBe(false);
    expect(
      ObservationEventSchema.safeParse({
        ...baseEvent,
        type: "navigation",
        route_template: "/boards/:id",
      }).success,
    ).toBe(true);
  });
  it("caps batch size", () => {
    const events = Array.from({ length: 201 }, (_, i) => ({
      ...baseEvent,
      event_id: `e${i}`,
      sequence: i,
    }));
    expect(
      ObservationBatchSchema.safeParse({ observation_session_id: "obs_1", batch_id: "b1", events })
        .success,
    ).toBe(false);
  });
});

describe("MonitoringPolicySchema", () => {
  it("defaults to disabled with the spec's proposed values", () => {
    const p = MonitoringPolicySchema.parse({ schema_version: "1.0", policy_id: "p" });
    expect(p.enabled).toBe(false);
    expect(p.window_ms).toBe(90_000);
    expect(p.candidate_friction_threshold).toBe(0.85);
    expect(p.max_evaluations_per_product_day).toBe(1000);
  });
  it("rejects a sample rate above 1", () => {
    expect(
      MonitoringPolicySchema.safeParse({
        schema_version: "1.0",
        policy_id: "p",
        normal_journey_sample_rate: 2,
      }).success,
    ).toBe(false);
  });
});

const questions: JevQuestions = {
  evidence_sufficiency: {
    type: "choice",
    instructions: "Enough context?",
    criteria: { sufficient: "a", partial: "b", insufficient: "c" },
  },
  ux_friction_observed: {
    type: "noul",
    instructions: "Difficulty making progress?",
    criteria: { true: "x", false: "y" },
  },
  targeted_research_warranted: { type: "noul", instructions: "Worth a study?" },
  problem_category: {
    type: "choice",
    instructions: "Category",
    criteria: { discoverability: "a", other_or_uncertain: "b" },
  },
};

describe("DetectorDefinitionSchema", () => {
  const detector = {
    schema_version: "1.0",
    detector_id: "share_drawing_export",
    version: 1,
    journey_id: "share_drawing",
    app_build_ref: "build_1",
    instrumentation_schema_version: "1.0",
    required_events: ["journey_start", "action_result", "completion"],
    questions,
    evaluation_policy_ref: "policy_1",
    provenance: "manual",
  };
  it("accepts a well-formed detector", () => {
    expect(DetectorDefinitionSchema.parse(detector).version).toBe(1);
    expect(validateDetectorQuestions(questions)).toEqual([]);
  });
  it("requires the base questions and an other_or_uncertain category", () => {
    const { problem_category: _p, ...noCategory } = questions;
    expect(validateDetectorQuestions(noCategory).join(" ")).toMatch(/problem_category/);
    const badCat: JevQuestions = {
      ...questions,
      problem_category: {
        type: "choice",
        instructions: "Category",
        criteria: { discoverability: "a" },
      },
    };
    expect(validateDetectorQuestions(badCat).join(" ")).toMatch(/other_or_uncertain/);
  });
  it("rejects questions that reference other answers or exceed size", () => {
    const dependent: JevQuestions = {
      ...questions,
      extra: { type: "noul", instructions: "If ux_friction_observed is true then…" },
    };
    expect(validateDetectorQuestions(dependent).join(" ")).toMatch(/depend/);
    const huge: JevQuestions = {
      ...questions,
      extra: { type: "noul", instructions: "x".repeat(3000) },
    };
    expect(validateDetectorQuestions(huge).join(" ")).toMatch(/size/);
  });
});

describe("Jev contracts", () => {
  it("builds a valid request and parses a response", () => {
    const req = JevRequestSchema.parse({ model: "jev-latest", state: { a: 1 }, questions });
    expect(req.model).toBe("jev-latest");
    const res = JevResponseSchema.parse({
      model: "jev-1.13.0",
      answers: {
        evidence_sufficiency: {
          type: "choice",
          choice: "partial",
          confidence: 0.62,
          probabilities: { sufficient: 0.2, partial: 0.62, insufficient: 0.18 },
        },
        ux_friction_observed: { type: "noul", noul: 0.91 },
        targeted_research_warranted: { type: "noul", noul: 0.84 },
        problem_category: {
          type: "choice",
          choice: "discoverability",
          confidence: 0.7,
          probabilities: { discoverability: 0.7, other_or_uncertain: 0.3 },
        },
      },
      usage: { input_tokens: 812, output_tokens: 40 },
    });
    expect(res.answers.ux_friction_observed).toMatchObject({ noul: 0.91 });
  });
  it("rejects answers whose keys, types or bounds do not match the questions", () => {
    const answers = {
      evidence_sufficiency: { type: "choice", choice: "maybe", confidence: 0.6, probabilities: {} },
      ux_friction_observed: { type: "noul", noul: 1.4 },
      targeted_research_warranted: { type: "noul", noul: 0.5 },
      problem_category: {
        type: "choice",
        choice: "discoverability",
        confidence: 0.7,
        probabilities: {},
      },
    };
    const problems = validateAnswersAgainstQuestions(questions, answers);
    expect(problems.join(" ")).toMatch(/evidence_sufficiency/);
    expect(problems.join(" ")).toMatch(/ux_friction_observed/);
    const { problem_category: _x, ...missing } = answers;
    expect(validateAnswersAgainstQuestions(questions, missing).join(" ")).toMatch(/missing/);
  });
});
