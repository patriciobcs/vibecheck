type StageState = "done" | "active" | "waiting" | "skipped" | "blocked";

export type TimelineStage = {
  key: string;
  label: string;
  state: StageState;
  count?: number;
  waitingReason?: string;
};

type TimelineInputs = {
  analysisRuns: Array<{ status: string }>;
  participation: Array<{ kind: string }>;
  findings: Array<{ issueUrl: string | null }>;
  summary: { status: string } | null;
  repairs: Array<{ status: string; blockedReason?: string | null }>;
  paused?: boolean;
};

type StudyLike = { status: string };
type PlanLike = { automation: { mode: "issues_only" | "draft_pr" | "prototype_and_retest" } };

function stage(
  key: string,
  label: string,
  state: StageState,
  count?: number,
  waitingReason?: string,
): TimelineStage {
  return {
    key,
    label,
    state,
    ...(count === undefined ? {} : { count }),
    ...(waitingReason ? { waitingReason } : {}),
  };
}

export function studyStage(
  studyRow: StudyLike,
  plan: PlanLike,
  inputs: TimelineInputs,
): TimelineStage[] {
  const sessions = inputs.participation.filter((event) => event.kind === "completed").length;
  const pendingAnalysis = inputs.analysisRuns.some(
    (run) => run.status === "queued" || run.status === "analysing",
  );
  const issueCount = inputs.findings.filter((finding) => finding.issueUrl).length;
  const repair = inputs.repairs.at(-1);
  const isTerminalMode =
    plan.automation.mode === "issues_only"
      ? "issues"
      : plan.automation.mode === "draft_pr"
        ? "draft_pr"
        : "preview";
  const proposed =
    studyRow.status === "draft"
      ? stage("proposed", "Proposed", "active")
      : stage("proposed", "Proposed", "done");
  const published =
    studyRow.status === "draft"
      ? stage("published", "Published", "waiting", undefined, "not published")
      : stage("published", "Published", "done");
  let collecting: TimelineStage;
  if (inputs.paused) {
    collecting = stage("collecting", "Collecting", "waiting", sessions, "paused");
  } else if (sessions === 0 && inputs.analysisRuns.length === 0) {
    collecting = stage("collecting", "Collecting", "waiting", 0, "no sessions yet");
  } else if (pendingAnalysis) {
    collecting = stage("collecting", "Collecting", "active", sessions, "analysis running");
  } else {
    collecting = stage("collecting", "Collecting", "done", sessions);
  }
  const summarized =
    inputs.summary?.status === "summarized" ||
    inputs.summary?.status === "insufficient_data" ||
    inputs.summary?.status === "failed"
      ? stage("summarized", "Summarized", "done")
      : inputs.paused
        ? stage("summarized", "Summarized", "waiting", undefined, "paused")
        : stage(
            "summarized",
            "Summarized",
            "waiting",
            undefined,
            pendingAnalysis ? "analysis running" : "agent running",
          );
  const issues =
    isTerminalMode === "issues"
      ? issueCount || inputs.findings.length === 0
        ? stage("issues", "Issues", "done", issueCount)
        : stage("issues", "Issues", "waiting", 0, "agent running")
      : issueCount
        ? stage("issues", "Issues", "done", issueCount)
        : stage("issues", "Issues", "waiting", 0, "agent running");
  const draftPr =
    isTerminalMode === "issues"
      ? stage("draft_pr", "Draft PR", "skipped")
      : repair?.status === "blocked"
        ? stage(
            "draft_pr",
            "Draft PR",
            "blocked",
            undefined,
            `blocked: ${repair.blockedReason ?? "permissions"}`,
          )
        : repair?.status === "failed"
          ? stage("draft_pr", "Draft PR", "blocked", undefined, "checks failed")
          : repair?.status === "draft_pr_ready" || repair?.status === "preview_ready"
            ? stage("draft_pr", "Draft PR", "done")
            : stage("draft_pr", "Draft PR", "waiting", undefined, "agent running");
  const preview =
    isTerminalMode !== "preview"
      ? stage("preview", "Preview", "skipped")
      : repair?.status === "preview_ready"
        ? stage("preview", "Preview", "done")
        : repair?.status === "blocked"
          ? stage(
              "preview",
              "Preview",
              "blocked",
              undefined,
              `blocked: ${repair.blockedReason ?? "permissions"}`,
            )
          : stage(
              "preview",
              "Preview",
              "waiting",
              undefined,
              repair?.status === "validating" ? "checks failed" : "agent running",
            );
  return [proposed, published, collecting, summarized, issues, draftPr, preview];
}
