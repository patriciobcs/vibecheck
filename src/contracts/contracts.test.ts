import { describe, expect, it } from "vitest";
import { agentOutputJsonSchema, agentOutputSchema } from "./agentOutput";
import { studyPlanSchema } from "./studyPlan";

describe("contracts", () => {
  it("accepts the study plan handoff", () => {
    expect(studyPlanSchema.parse({
      schema_version: "1.0", study_id: "study_example", study_revision: 1, product_id: "product_example",
      task: { task_id: "task_capture_ideas", participant_prompt: "Add ideas.", research_question: "Can users capture ideas?", time_limit_seconds: 300, success_rule_ref: "stickynote_capture_v1", fixture_ref: "excalidraw_fixture_v1" },
      baseline: { commit_sha: "sha", environment_ref: "baseline_preview" },
      recruitment: { source: "marketplace", target_count: 2, cohort: "fresh", eligibility_rule_ref: "eligible_whiteboard_users_v1" },
      capture: { screen: "required", microphone: "required", webcam: "off", pointer: "on", keyboard: "semantic_only", text_values: "off", retention_days: 30 },
      automation: { mode: "prototype_and_retest", max_variants: 1, max_repair_attempts: 2, agent_budget_ref: "demo_budget", retest_target_count: 2 },
    }).schema_version).toBe("1.0");
  });
  it("rejects proposals when outcome cannot_assess", () => {
    expect(agentOutputSchema.safeParse({ schema_version: "1.0", discovery_run_id: "run", source_revision: "sha", outcome: "cannot_assess", proposals: [{ task_id: "x" }] }).success).toBe(false);
  });
  it("rejects a proposal without success_rule_ref", () => {
    expect(agentOutputSchema.safeParse({ schema_version: "1.0", discovery_run_id: "run", source_revision: "sha", proposals: [{ task_id: "x", research_question: "q", participant_prompt: "p", rationale: "r", evidence_refs: [], evidence_type: "reported", eligibility_rule_ref: "e", uncertainties: [] }] }).success).toBe(false);
  });
  it("exports a root object JSON schema without refs", () => {
    expect("type" in agentOutputJsonSchema ? agentOutputJsonSchema.type : undefined).toBe("object");
    expect("$ref" in agentOutputJsonSchema).toBe(false);
  });
});
