import { describe, expect, it } from "vitest";
import { agentOutputJsonSchema, agentOutputSchema } from "./agentOutput";
import { studyPlanSchema } from "./studyPlan";
import { analysisOutputSchema, titleSchema } from "./analysisOutput";
import { sessionManifestSchema } from "./session";
import { repoBindingSchema } from "./repoBinding";
import { repairOutputSchema } from "./repairOutput";
import { repairRunSchema, toRepairRunContract } from "./repairRun";
import { participationEventSchema } from "./participation";
import { summaryNarrativeOutputSchema } from "./experimentSummary";
import { signalSchema } from "./signal";

describe("contracts", () => {
  it("accepts the study plan handoff", () => {
    expect(
      studyPlanSchema.parse({
        schema_version: "1.0",
        study_id: "study_example",
        study_revision: 1,
        product_id: "product_example",
        task: {
          task_id: "task_capture_ideas",
          participant_prompt: "Add ideas.",
          research_question: "Can users capture ideas?",
          time_limit_seconds: 300,
          success_rule_ref: "stickynote_capture_v1",
          fixture_ref: "excalidraw_fixture_v1",
        },
        baseline: { commit_sha: "sha", environment_ref: "baseline_preview" },
        recruitment: {
          source: "marketplace",
          target_count: 2,
          cohort: "fresh",
          eligibility_rule_ref: "eligible_whiteboard_users_v1",
        },
        capture: {
          screen: "required",
          microphone: "required",
          webcam: "off",
          pointer: "on",
          keyboard: "semantic_only",
          text_values: "off",
          retention_days: 30,
        },
        automation: {
          mode: "prototype_and_retest",
          max_variants: 1,
          max_repair_attempts: 2,
          agent_budget_ref: "demo_budget",
          retest_target_count: 2,
        },
      }).schema_version,
    ).toBe("1.0");
  });
  it("rejects proposals when outcome cannot_assess", () => {
    expect(
      agentOutputSchema.safeParse({
        schema_version: "1.0",
        discovery_run_id: "run",
        source_revision: "sha",
        outcome: "cannot_assess",
        proposals: [{ task_id: "x" }],
      }).success,
    ).toBe(false);
  });
  it("rejects a proposal without success_rule_ref", () => {
    expect(
      agentOutputSchema.safeParse({
        schema_version: "1.0",
        discovery_run_id: "run",
        source_revision: "sha",
        proposals: [
          {
            task_id: "x",
            research_question: "q",
            participant_prompt: "p",
            rationale: "r",
            evidence_refs: [],
            evidence_type: "reported",
            eligibility_rule_ref: "e",
            uncertainties: [],
          },
        ],
      }).success,
    ).toBe(false);
  });
  it("exports a root object JSON schema without refs", () => {
    expect("type" in agentOutputJsonSchema ? agentOutputJsonSchema.type : undefined).toBe("object");
    expect("$ref" in agentOutputJsonSchema).toBe(false);
  });
  it("accepts the fixture session manifest and analysis output", async () => {
    const manifest =
      await import("../../fixtures/sessions/sample_session_capture_ideas/manifest.json");
    const output = await import("../../fixtures/analysis/sample_session_capture_ideas.json");
    expect(sessionManifestSchema.parse(manifest.default).provenance).toBe("fixture");
    expect(analysisOutputSchema.parse(output.default).findings).toHaveLength(1);
  });
  it("accepts and rejects finding title formats", () => {
    expect(titleSchema.safeParse("Toolbar: sticky note tool is hard to discover").success).toBe(
      true,
    );
    for (const title of [
      "Toolbar: sticky note tool is hard to discover.",
      "sticky note tool is hard to discover",
      "TOOLBAR: STICKY NOTE TOOL IS HARD TO DISCOVER",
      ": sticky note tool is hard to discover",
      "Toolbar: ",
      "Toolbar: this title is intentionally much longer than seventy-two characters and fails",
    ]) {
      expect(titleSchema.safeParse(title).success).toBe(false);
    }
  });
  it("rejects findings for a no-finding outcome", () => {
    expect(
      analysisOutputSchema.safeParse({
        schema_version: "1.0",
        evidence_package_id: "package",
        session_id: "session",
        outcome: "no_finding",
        findings: [
          {
            category: "other",
            semantic_target: "target",
            observation: "observation",
            hypothesis: "hypothesis",
            evidence: [{ segment_ids: ["segment"], event_ids: [], start_ms: 0, end_ms: 1 }],
            impact: "no_impact",
            limitations: [],
          },
        ],
      }).success,
    ).toBe(false);
  });
  it("accepts local and GitHub repository bindings", () => {
    expect(repoBindingSchema.parse({ provider: "local", path: "/tmp/excalidraw" })).toEqual({
      provider: "local",
      path: "/tmp/excalidraw",
    });
    expect(repoBindingSchema.parse({ provider: "github", owner: "owner", repo: "repo" })).toEqual({
      provider: "github",
      owner: "owner",
      repo: "repo",
      issues_enabled: true,
    });
  });
  it("compares signal windows by instant", () => {
    expect(
      signalSchema.safeParse({
        schema_version: "1.0",
        signal_id: "signal",
        source: "jev",
        title: "Toolbar hesitation",
        description: "Repeated hesitation.",
        severity: "low",
        semantic_target: "toolbar",
        window_start: "2025-01-01T01:00:00+01:00",
        window_end: "2024-12-31T23:30:00Z",
        evidence_ref: null,
      }).success,
    ).toBe(false);
    expect(
      signalSchema.safeParse({
        schema_version: "1.0",
        signal_id: "signal",
        source: "jev",
        title: "Toolbar hesitation",
        description: "Repeated hesitation.",
        severity: "low",
        semantic_target: "toolbar",
        window_start: "2025-01-01T01:00:00+01:00",
        window_end: "2025-01-01T00:00:00Z",
        evidence_ref: null,
      }).success,
    ).toBe(true);
  });
  it("requires session IDs for started, completed, and abandoned participation", () => {
    const base = {
      schema_version: "1.0" as const,
      event_id: "event",
      study_id: "study",
      study_revision: 1,
      participant_ref: "opaque",
      occurred_at: new Date().toISOString(),
    };
    expect(
      participationEventSchema.safeParse({ ...base, kind: "invited", session_id: null }).success,
    ).toBe(true);
    expect(
      participationEventSchema.safeParse({ ...base, kind: "completed", session_id: null }).success,
    ).toBe(false);
    expect(
      participationEventSchema.safeParse({ ...base, kind: "completed", session_id: "session" })
        .success,
    ).toBe(true);
  });
  it("requires three to five cited observations in summary narrative output", () => {
    const base = {
      schema_version: "1.0" as const,
      study_id: "study",
      headline: "A useful summary headline",
      limitations: [],
    };
    expect(
      summaryNarrativeOutputSchema.safeParse({
        ...base,
        observations: [
          { text: "one", finding_ids: ["finding"] },
          { text: "two", finding_ids: ["finding"] },
          { text: "three", finding_ids: ["finding"] },
        ],
      }).success,
    ).toBe(true);
    expect(summaryNarrativeOutputSchema.safeParse({ ...base, observations: [] }).success).toBe(
      false,
    );
  });
  it("enforces repair output refinement rules", () => {
    const base = {
      schema_version: "1.0" as const,
      repair_run_id: "run",
      reproduced: true,
      reproduction_notes: "reproduced",
      summary: "candidate",
      changed_paths: ["packages/excalidraw/components/Toolbar.tsx"],
      limitations: [],
    };
    expect(
      repairOutputSchema.safeParse({
        ...base,
        outcome: "candidate",
        branch: "vibecheck/repair-run",
      }).success,
    ).toBe(true);
    expect(
      repairOutputSchema.safeParse({
        ...base,
        outcome: "candidate",
        branch: null,
      }).success,
    ).toBe(false);
    expect(
      repairOutputSchema.safeParse({
        ...base,
        outcome: "cannot_reproduce",
        branch: "unexpected",
      }).success,
    ).toBe(false);
  });
  it("maps a repair run to the shared contract", () => {
    const contract = toRepairRunContract({
      id: "run",
      findingId: "finding",
      issueRepo: "owner/repo",
      issueNumber: 4,
      mode: "draft_pr",
      baseCommitSha: "base",
      candidateCommitSha: "candidate",
      devinSessionId: "session",
      devinSessionUrl: "https://devin.example/session",
      attempt: 1,
      validatorVersion: "fixture_validator_v1",
      checkRunId: "check",
      previewId: null,
      pullRequestNumber: 5,
      pullRequestUrl: "https://github.com/owner/repo/pull/5",
      status: "draft_pr_ready",
    });
    expect(repairRunSchema.parse(contract)).toMatchObject({
      issue_ref: "owner/repo#4",
      checks_ref: "check",
      pull_request_ref: "#5|https://github.com/owner/repo/pull/5",
    });
  });
});
