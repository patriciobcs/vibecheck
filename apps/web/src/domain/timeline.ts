import { StudyPlanSchema } from "@vibecheck/contracts";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db/client";

export type StageState = "done" | "active" | "waiting" | "skipped" | "blocked";

export type TimelineStage = {
  key: string;
  label: string;
  state: StageState;
  count?: number;
  waitingReason?: string;
};

// TODO(VC-05): wire to experiment summaries once PR #6's port lands on main.
export type SummarySource = {
  status: "summarized" | "insufficient_data" | "failed" | "pending";
} | null;
// TODO(VC-04): wire to repair runs once PR #5's port lands on main.
export type RepairSource = { status: string; blockedReason?: string | null };

export type TimelineInputs = {
  /** Completed study sessions (VC-02 session rows that ended/uploaded successfully). */
  sessions: number;
  analysisRuns: Array<{ status: string }>;
  findings: Array<{ issueUrl: string | null }>;
  summary: SummarySource;
  repairs: RepairSource[];
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

/**
 * The owner-visible pipeline for one study. The terminal stage follows the plan's automation
 * mode: `issues_only` ends at Issues, `draft_pr` at Draft PR, `prototype_and_retest` at Preview
 * (retesting is deferred to VC-05). Every stage reports a persisted-state reason when waiting.
 */
export function studyStages(
  study: StudyLike,
  plan: PlanLike,
  inputs: TimelineInputs,
): TimelineStage[] {
  const sessions = inputs.sessions;
  const pendingAnalysis = inputs.analysisRuns.some(
    (run) => run.status === "queued" || run.status === "analysing",
  );
  const issueCount = inputs.findings.filter((finding) => finding.issueUrl).length;
  const repair = inputs.repairs.at(-1);
  const terminal =
    plan.automation.mode === "issues_only"
      ? "issues"
      : plan.automation.mode === "draft_pr"
        ? "draft_pr"
        : "preview";
  const proposed =
    study.status === "draft"
      ? stage("proposed", "Proposed", "active")
      : stage("proposed", "Proposed", "done");
  const published =
    study.status === "draft"
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
    terminal === "issues"
      ? issueCount || inputs.findings.length === 0
        ? stage("issues", "Issues", "done", issueCount)
        : stage("issues", "Issues", "waiting", 0, "agent running")
      : issueCount
        ? stage("issues", "Issues", "done", issueCount)
        : stage("issues", "Issues", "waiting", 0, "agent running");
  const draftPr =
    terminal === "issues"
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
    terminal !== "preview"
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

/** Sessions count toward Collecting once they have ended (upload finished or terminal outcome). */
async function completedSessionCount(studyId: string) {
  const rows = await db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .innerJoin(schema.assignments, eq(schema.sessions.assignmentId, schema.assignments.id))
    .where(and(eq(schema.assignments.studyId, studyId), isNotNull(schema.sessions.endedAt)));
  return rows.length;
}

export async function studyTimeline(tenantIds: string[], studyId: string) {
  if (tenantIds.length === 0) return null;
  const study = await db.query.studies.findFirst({
    where: and(eq(schema.studies.id, studyId), inArray(schema.studies.tenantId, tenantIds)),
  });
  if (!study) return null;
  const revision = await db.query.studyRevisions.findFirst({
    where: and(
      eq(schema.studyRevisions.studyId, study.id),
      eq(schema.studyRevisions.revision, study.currentRevision),
    ),
  });
  if (!revision) return null;
  const parsed = StudyPlanSchema.safeParse(revision.plan);
  if (!parsed.success) return null;
  const tenant = await db.query.tenants.findFirst({
    where: eq(schema.tenants.id, study.tenantId),
    columns: { paused: true },
  });
  const [sessions, analysisRuns, findings] = await Promise.all([
    completedSessionCount(study.id),
    db.query.analysisRuns.findMany({
      where: eq(schema.analysisRuns.studyId, study.id),
      columns: { status: true },
    }),
    db.query.findings.findMany({
      where: eq(schema.findings.studyId, study.id),
      columns: { issueUrl: true },
    }),
  ]);
  return {
    study_id: study.id,
    mode: parsed.data.automation.mode,
    stages: studyStages(study, parsed.data, {
      sessions,
      analysisRuns,
      findings,
      // TODO(VC-05): latest experiment summary once PR #6's port lands on main.
      summary: null,
      // TODO(VC-04): repair runs once PR #5's port lands on main.
      repairs: [],
      paused: tenant?.paused ?? false,
    }),
  };
}
