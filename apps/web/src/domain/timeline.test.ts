import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "@/test/db";
import { seedStudy } from "@/test/fixtures";
import { studyStages, studyTimeline } from "./timeline";

const base = { sessions: 0, analysisRuns: [], findings: [], summary: null, repairs: [] };

describe("studyStages", () => {
  it("marks a draft study as proposed/active", () => {
    const stages = studyStages({ status: "draft" }, { automation: { mode: "issues_only" } }, base);
    expect(stages.find((s) => s.key === "proposed")?.state).toBe("active");
    expect(stages.find((s) => s.key === "published")).toMatchObject({
      state: "waiting",
      waitingReason: "not published",
    });
  });

  it("ends issues_only studies at Issues and skips later stages", () => {
    const stages = studyStages(
      { status: "published" },
      { automation: { mode: "issues_only" } },
      {
        ...base,
        sessions: 2,
        findings: [{ issueUrl: "https://github.com/example/1" }],
        summary: { status: "summarized" },
      },
    );
    expect(stages.find((s) => s.key === "issues")).toMatchObject({ state: "done", count: 1 });
    expect(stages.slice(-2).map((s) => s.state)).toEqual(["skipped", "skipped"]);
  });

  it("waits for sessions while collecting and shows paused", () => {
    const plan = { automation: { mode: "issues_only" as const } };
    const collecting = studyStages({ status: "published" }, plan, base).find(
      (s) => s.key === "collecting",
    );
    expect(collecting).toMatchObject({ state: "waiting", waitingReason: "no sessions yet" });
    const paused = studyStages({ status: "published" }, plan, { ...base, paused: true }).find(
      (s) => s.key === "collecting",
    );
    expect(paused).toMatchObject({ state: "waiting", waitingReason: "paused" });
  });

  it("waits on Draft PR when the mode is draft_pr with no repairs", () => {
    const stages = studyStages(
      { status: "published" },
      { automation: { mode: "draft_pr" } },
      { ...base, findings: [{ issueUrl: "https://github.com/example/1" }] },
    );
    expect(stages.find((s) => s.key === "draft_pr")).toMatchObject({
      state: "waiting",
      waitingReason: "agent running",
    });
    expect(stages.find((s) => s.key === "preview")?.state).toBe("skipped");
  });
});

describe("studyTimeline", () => {
  beforeEach(resetDb);
  it("returns stages for an owned study and null otherwise", async () => {
    const { tenantId, studyId } = await seedStudy();
    const timeline = await studyTimeline([tenantId], studyId);
    expect(timeline?.study_id).toBe(studyId);
    expect(timeline?.stages.map((s) => s.key)).toEqual([
      "proposed",
      "published",
      "collecting",
      "summarized",
      "issues",
      "draft_pr",
      "preview",
    ]);
    expect(await studyTimeline(["tenant_other"], studyId)).toBeNull();
  });
});
