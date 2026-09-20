import { AnalysisOutputSchema, EvidencePackageSchema } from "@vibecheck/contracts";
import { describe, expect, it } from "vitest";
import { validateAnalysisOutput } from "./analyses";

const evidence = EvidencePackageSchema.parse({
  schema_version: "1.0",
  evidence_package_id: "package_1",
  session_id: "session_1",
  study_id: "study_1",
  study_revision: 1,
  baseline_commit_sha: "a".repeat(40),
  task: {
    task_id: "task_1",
    participant_prompt: "Complete the task",
    research_question: "Can the task be completed?",
    success_rule_ref: "success_v1",
    time_limit_seconds: 60,
  },
  outcome: {
    participant_reported: "completed",
    instrumented: "unknown",
  },
  completeness: "complete",
  instrumentation: "sdk",
  session_duration_ms: 1000,
  events: [
    {
      event_id: "event_1",
      session_id: "session_1",
      sequence: 1,
      t_ms: 500,
      type: "click",
      payload: {},
    },
  ],
  events_truncated: false,
  transcript: [
    {
      segment_id: "segment_1",
      start_ms: 400,
      end_ms: 700,
      speaker: "participant",
      text: "I found it",
    },
  ],
  transcript_truncated: false,
  media: [],
  provenance: "fixture",
});

describe("VC-03 analysis contracts", () => {
  it("accepts concise human-readable titles", () => {
    expect(
      AnalysisOutputSchema.parse({
        schema_version: "1.0",
        evidence_package_id: "package_1",
        session_id: "session_1",
        findings: [
          {
            title: "Toolbar: sticky note tool is hard to discover",
            category: "discoverability",
            semantic_target: "toolbar.sticky_note",
            observation: "The tool was difficult to find.",
            hypothesis: "The control may be hidden.",
            evidence: [
              {
                event_ids: ["event_1"],
                segment_ids: ["segment_1"],
                start_ms: 400,
                end_ms: 700,
                quote: "I found it",
              },
            ],
            impact: "task_slowed",
            limitations: [],
          },
        ],
      }).findings[0]?.title,
    ).toBe("Toolbar: sticky note tool is hard to discover");
  });

  it.each([
    "Toolbar: sticky note tool is hard to discover.",
    "toolbar sticky note tool is hard to discover",
    "TOOLBAR: STICKY NOTE TOOL IS HARD TO DISCOVER",
    `Toolbar: ${"x".repeat(65)}`,
  ])("rejects malformed title %s", (title) => {
    expect(() =>
      AnalysisOutputSchema.parse({
        schema_version: "1.0",
        evidence_package_id: "package_1",
        session_id: "session_1",
        findings: [
          {
            title,
            category: "discoverability",
            semantic_target: "toolbar.sticky_note",
            observation: "Observed",
            hypothesis: "Possible",
            evidence: [
              { event_ids: ["event_1"], segment_ids: ["segment_1"], start_ms: 400, end_ms: 700 },
            ],
            impact: "task_slowed",
            limitations: [],
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects citations that are not in the evidence package", () => {
    const result = validateAnalysisOutput(
      {
        schema_version: "1.0",
        evidence_package_id: "package_1",
        session_id: "session_1",
        findings: [
          {
            title: "Toolbar: sticky note tool is hard to discover",
            category: "discoverability",
            semantic_target: "toolbar.sticky_note",
            observation: "Observed",
            hypothesis: "Possible",
            evidence: [
              { event_ids: ["invented"], segment_ids: ["segment_1"], start_ms: 400, end_ms: 700 },
            ],
            impact: "task_slowed",
            limitations: [],
          },
        ],
      },
      evidence,
    );
    expect(result).toEqual({ success: false, problems: "invented event_id citation" });
  });
});
