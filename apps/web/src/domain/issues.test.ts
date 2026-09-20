import { StudyPlanSchema } from "@vibecheck/contracts";
import { describe, expect, it } from "vitest";
import { renderIssueBody, sanitizeForPublic } from "./issues";

const plan = StudyPlanSchema.parse({
  schema_version: "1.0",
  study_id: "study_1",
  study_revision: 1,
  product_id: "product_1",
  baseline: {
    commit_sha: "a".repeat(40),
    environment_ref: "fixture",
  },
  task: {
    task_id: "task_1",
    participant_prompt: "Complete the task",
    research_question: "Can the task be completed?",
    time_limit_seconds: 60,
    success_rule_ref: "success_v1",
    fixture_ref: "fixture",
  },
  recruitment: {
    source: "direct_link",
    target_count: 1,
    cohort: "fresh",
    eligibility_rule_ref: "any_visitor_v1",
  },
  capture: {
    screen: "off",
    microphone: "off",
    webcam: "off",
    pointer: "off",
    keyboard: "off",
    text_values: "off",
    retention_days: 30,
  },
  automation: {
    mode: "issues_only",
    max_variants: 0,
    max_repair_attempts: 0,
    agent_budget_ref: "fixture",
    retest_target_count: 0,
  },
});

const finding = {
  id: "finding_1",
  tenantId: "tenant_1",
  studyId: "study_1",
  studyRevision: 1,
  baselineCommitSha: "a".repeat(40),
  title: "Toolbar: sticky note tool is hard to discover",
  fingerprint: "f".repeat(64),
  category: "discoverability",
  semanticTarget: "toolbar.sticky_note",
  observation: "A participant struggled https://private.example/session",
  hypothesis: "The tool is hard to find",
  impact: "task_slowed",
  certainty: "preliminary",
  limitations: ["One session"],
  suggestedExperiment: "Label the tool",
  evidence: [],
  observedSessionCount: 1,
  eligibleSessionCount: 1,
  provenance: "fixture",
  issueRepo: null,
  issueNumber: null,
  issueUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as never;
const findingTitle = "Toolbar: sticky note tool is hard to discover";

describe("VC-03 issue rendering", () => {
  it("renders the finding title and redacts non-dashboard URLs", () => {
    const body = renderIssueBody(finding, plan, null);
    expect(body).toContain("## Seamless UX finding");
    expect(sanitizeForPublic(findingTitle, null)).toBe(findingTitle);
    expect(body).toContain("[redacted url]");
    expect(body).not.toContain("private.example");
  });

  it("keeps a configured public dashboard URL in the issue body", () => {
    const body = renderIssueBody(finding, plan, "https://vibecheck.example.com");
    expect(body).toContain("- Dashboard: https://vibecheck.example.com");
    expect(body).toContain("[redacted url]");
    expect(body).not.toContain("private.example");
  });
});
