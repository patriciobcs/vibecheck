import { describe, expect, it } from "vitest";
import { SAMPLE_STUDY_PLAN } from "./sample-plan";
import { StudyPlanSchema } from "./study-plan";

const samplePlan = SAMPLE_STUDY_PLAN;

describe("StudyPlanSchema", () => {
  it("accepts the sample plan from the spec index", () => {
    expect(StudyPlanSchema.parse(samplePlan)).toEqual(samplePlan);
  });

  it("rejects text_values capture other than off in the MVP", () => {
    const plan = { ...samplePlan, capture: { ...samplePlan.capture, text_values: "on" } };
    expect(StudyPlanSchema.safeParse(plan).success).toBe(false);
  });

  it("rejects a zero target_count", () => {
    const plan = { ...samplePlan, recruitment: { ...samplePlan.recruitment, target_count: 0 } };
    expect(StudyPlanSchema.safeParse(plan).success).toBe(false);
  });

  it("rejects a non-integer study_revision", () => {
    expect(StudyPlanSchema.safeParse({ ...samplePlan, study_revision: 1.5 }).success).toBe(false);
  });

  it("accepts a bounded participant scenario", () => {
    expect(samplePlan.task.scenario?.steps).toHaveLength(3);
  });

  it("rejects scenarios with more than seven steps", () => {
    const scenario = {
      intro: "Complete the task.",
      steps: Array.from({ length: 8 }, (_, i) => ({
        order: i + 1,
        instruction: `Step ${i + 1}`,
      })),
      think_aloud_cues: [],
      estimated_minutes: 5,
    };
    expect(
      StudyPlanSchema.safeParse({
        ...samplePlan,
        task: { ...samplePlan.task, scenario },
      }).success,
    ).toBe(false);
  });
});
