import { describe, expect, it } from "vitest";
import { fixtureRepairProvider } from "./fixture";

describe("fixture repair provider", () => {
  it("returns a candidate for the real run and supplied branch", async () => {
    const result = await fixtureRepairProvider.start({
      repairRunId: "repair_123",
      repo: { owner: "example", repo: "demo" },
      baseCommitSha: "base",
      branchName: "vibecheck/repair-repair_123",
      finding: {
        title: "Toolbar: sticky note tool is hard to discover",
        category: "discoverability",
        semanticTarget: "toolbar.sticky_note",
        observation: "Observed",
        hypothesis: "Possible",
        suggestedExperiment: null,
        limitations: [],
        reproductionSteps: "1. Follow the task.",
      },
      task: { participant_prompt: "Do the task", success_rule_ref: "success_v1" },
      allowedPaths: ["packages/excalidraw/"],
      invariants: [],
    });
    expect(result.raw).toMatchObject({
      repair_run_id: "repair_123",
      branch: "vibecheck/repair-repair_123",
      outcome: "candidate",
    });
  });
});
