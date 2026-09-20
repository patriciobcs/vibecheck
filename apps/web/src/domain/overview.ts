import { RepoBindingSchema, StudyPlanSchema } from "@vibecheck/contracts";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { hasGithubCredentials } from "@/providers/github/auth";
import { type RepairSource, studyStages } from "./timeline";

/**
 * VC-06 product overview: everything derived from persisted rows — repo binding and credential
 * health, studies with their stage strip, finding/issue counts and research candidates.
 */
export async function productOverview(tenantIds: string[], productId: string) {
  if (tenantIds.length === 0) return null;
  const product = await db.query.products.findFirst({
    where: and(eq(schema.products.id, productId), inArray(schema.products.tenantId, tenantIds)),
  });
  if (!product) return null;
  const parsedBinding = product.repoBinding
    ? RepoBindingSchema.safeParse(product.repoBinding)
    : null;
  const binding = parsedBinding?.success ? parsedBinding.data : null;
  const studies = await db.query.studies.findMany({
    where: and(
      eq(schema.studies.productId, product.id),
      inArray(schema.studies.tenantId, tenantIds),
    ),
    orderBy: desc(schema.studies.createdAt),
  });
  const studyIds = studies.map((s) => s.id);
  const [revisions, assignments, analysisRuns, findings, summaries, repairs, candidates, tenant] =
    await Promise.all([
      studyIds.length
        ? db.query.studyRevisions.findMany({
            where: inArray(schema.studyRevisions.studyId, studyIds),
          })
        : [],
      studyIds.length
        ? db.query.assignments.findMany({
            where: inArray(schema.assignments.studyId, studyIds),
            columns: { id: true, studyId: true },
          })
        : [],
      studyIds.length
        ? db.query.analysisRuns.findMany({
            where: inArray(schema.analysisRuns.studyId, studyIds),
            columns: { studyId: true, status: true },
          })
        : [],
      studyIds.length
        ? db.query.findings.findMany({
            where: inArray(schema.findings.studyId, studyIds),
            columns: { studyId: true, certainty: true, issueUrl: true },
          })
        : [],
      studyIds.length
        ? db.query.experimentSummaries.findMany({
            where: and(
              eq(schema.experimentSummaries.tenantId, product.tenantId),
              inArray(schema.experimentSummaries.studyId, studyIds),
            ),
            orderBy: desc(schema.experimentSummaries.revision),
            columns: {
              studyId: true,
              status: true,
              revision: true,
              createdAt: true,
            },
          })
        : [],
      studyIds.length
        ? db.query.repairRuns.findMany({
            where: and(
              eq(schema.repairRuns.tenantId, product.tenantId),
              inArray(schema.repairRuns.studyId, studyIds),
            ),
            columns: { status: true, blockedReason: true, studyId: true, findingId: true },
          })
        : [],
      db.query.researchCandidates.findMany({
        where: and(
          eq(schema.researchCandidates.productId, product.id),
          eq(schema.researchCandidates.tenantId, product.tenantId),
        ),
        orderBy: desc(schema.researchCandidates.updatedAt),
      }),
      db.query.tenants.findFirst({
        where: eq(schema.tenants.id, product.tenantId),
        columns: { paused: true },
      }),
    ]);
  const endedSessions = assignments.length
    ? await db.query.sessions.findMany({
        where: and(
          inArray(
            schema.sessions.assignmentId,
            assignments.map((a) => a.id),
          ),
          isNotNull(schema.sessions.endedAt),
        ),
        columns: { assignmentId: true },
      })
    : [];
  const sessionsByStudy = new Map<string, number>();
  const assignmentStudy = new Map(assignments.map((a) => [a.id, a.studyId]));
  for (const row of endedSessions) {
    const studyId = assignmentStudy.get(row.assignmentId);
    if (studyId) sessionsByStudy.set(studyId, (sessionsByStudy.get(studyId) ?? 0) + 1);
  }
  const paused = tenant?.paused ?? false;
  const latestSummaryByStudy = new Map<string, (typeof summaries)[number]>();
  for (const summary of summaries) {
    const previous = latestSummaryByStudy.get(summary.studyId);
    if (!previous || summary.revision > previous.revision) {
      latestSummaryByStudy.set(summary.studyId, summary);
    }
  }
  const latestSummary = [...latestSummaryByStudy.values()].sort(
    (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
  )[0];
  const repairsByStudy = new Map<string, RepairSource[]>();
  const repairsByStatus: Record<string, number> = {};
  for (const repair of repairs) {
    repairsByStatus[repair.status] = (repairsByStatus[repair.status] ?? 0) + 1;
    const studyRepairs = repairsByStudy.get(repair.studyId) ?? [];
    studyRepairs.push({
      status: repair.status,
      blockedReason: repair.blockedReason,
    });
    repairsByStudy.set(repair.studyId, studyRepairs);
  }
  const planFor = (studyId: string, revision: number) => {
    const row = revisions.find((r) => r.studyId === studyId && r.revision === revision);
    if (!row) return null;
    const parsed = StudyPlanSchema.safeParse(row.plan);
    return parsed.success ? parsed.data : null;
  };
  const latestPlan = studies.length ? planFor(studies[0].id, studies[0].currentRevision) : null;
  return {
    product: {
      id: product.id,
      name: product.name,
      url: product.url,
      repo_binding:
        binding?.provider === "github"
          ? ({ kind: "github", repo: `${binding.owner}/${binding.repo}` } as const)
          : binding?.provider === "local"
            ? ({ kind: "local", path: binding.path } as const)
            : null,
      baseline_sha: latestPlan?.baseline.commit_sha ?? null,
      connection:
        binding?.provider === "github"
          ? { kind: "github" as const, healthy: hasGithubCredentials() }
          : binding?.provider === "local"
            ? { kind: "local" as const, healthy: Boolean(binding.path) }
            : { kind: "none" as const, healthy: false },
    },
    studies: studies.map((study) => {
      const plan = planFor(study.id, study.currentRevision);
      return {
        id: study.id,
        status: study.status,
        mode: plan?.automation.mode ?? null,
        stages: plan
          ? studyStages(study, plan, {
              sessions: sessionsByStudy.get(study.id) ?? 0,
              analysisRuns: analysisRuns.filter((r) => r.studyId === study.id),
              findings: findings.filter((f) => f.studyId === study.id),
              summary: latestSummaryByStudy.get(study.id)
                ? { status: latestSummaryByStudy.get(study.id)?.status ?? "collecting" }
                : null,
              repairs: repairsByStudy.get(study.id) ?? [],
              paused,
            })
          : [],
      };
    }),
    findings_needing_attention: findings.filter(
      (f) => f.certainty === "preliminary" || f.certainty === "contradictory" || !f.issueUrl,
    ).length,
    open_issues: findings.filter((f) => f.issueUrl).length,
    latest_summary: latestSummary
      ? {
          study_id: latestSummary.studyId,
          status: latestSummary.status,
          revision: latestSummary.revision,
          generated_at: latestSummary.createdAt.toISOString(),
        }
      : null,
    repairs_by_status: repairsByStatus,
    candidates_by_state: {
      proposed: candidates.filter((c) => c.state === "proposed").length,
      accepted: candidates.filter((c) => c.state === "accepted").length,
      dismissed: candidates.filter((c) => c.state === "dismissed").length,
      study_linked: candidates.filter((c) => c.state === "study_linked").length,
    },
    latest_candidates: candidates.slice(0, 10).map((candidate) => ({
      id: candidate.id,
      category: candidate.category,
      target_ref: candidate.targetRef,
      distinct_observation_sessions: candidate.distinctObservationSessions,
      state: candidate.state,
      created_at: candidate.createdAt.toISOString(),
    })),
    paused,
  };
}
