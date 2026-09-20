import { describe, expect, it } from "vitest";
import { studyStage } from "./timeline";

const study = { status: "published" };

describe("study timeline", () => {
  it("ends issues_only studies at Issues and skips later stages", () => {
    const stages = studyStage(
      study,
      { automation: { mode: "issues_only" } },
      {
        analysisRuns: [],
        participation: [{ kind: "completed" }],
        findings: [{ issueUrl: "https://github.com/example/1" }],
        summary: { status: "summarized" },
        repairs: [],
      },
    );
    expect(stages.find((stage) => stage.key === "issues")?.state).toBe("done");
    expect(stages.slice(-2).map((stage) => stage.state)).toEqual(["skipped", "skipped"]);
  });

  it("marks a blocked draft PR repair with its blocking reason", () => {
    const stages = studyStage(
      study,
      { automation: { mode: "draft_pr" } },
      {
        analysisRuns: [],
        participation: [{ kind: "completed" }],
        findings: [{ issueUrl: "https://github.com/example/1" }],
        summary: { status: "summarized" },
        repairs: [{ status: "blocked", blockedReason: "github_permissions" }],
      },
    );
    expect(stages.find((stage) => stage.key === "draft_pr")).toMatchObject({
      state: "blocked",
      waitingReason: "blocked: github_permissions",
    });
  });

  it("waits for sessions while collecting", () => {
    const collecting = studyStage(
      study,
      { automation: { mode: "issues_only" } },
      { analysisRuns: [], participation: [], findings: [], summary: null, repairs: [] },
    ).find((stage) => stage.key === "collecting");
    expect(collecting).toMatchObject({ state: "waiting", waitingReason: "no sessions yet" });
  });

  it("shows paused while collecting", () => {
    const collecting = studyStage(
      study,
      { automation: { mode: "issues_only" } },
      {
        analysisRuns: [],
        participation: [],
        findings: [],
        summary: null,
        repairs: [],
        paused: true,
      },
    ).find((stage) => stage.key === "collecting");
    expect(collecting).toMatchObject({ state: "waiting", waitingReason: "paused" });
  });
});
