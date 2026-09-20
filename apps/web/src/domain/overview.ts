import { RepoBindingSchema, StudyPlanSchema } from "@vibecheck/contracts";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { hasGithubCredentials } from "@/providers/github/auth";
import { studyStages } from "./timeline";

/**
 * VC-06 product overview: everything derived from persisted rows — repo binding and credential
 * health, studies with their stage strip, finding/issue counts and signal severity counts.
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
    where: eq(schema.studies.productId, product.id),
    orderBy: desc(schema.studies.createdAt),
  });
  const studyIds = studies.map((s) => s.id);
  const [revisions, assignments, analysisRuns, findings, signals, tenant] = await Promise.all([
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
    db.query.signals.findMany({
      where: eq(schema.signals.productId, product.id),
      columns: { severity: true },
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
              // TODO(VC-05): latest experiment summary once PR #6's port lands on main.
              summary: null,
              // TODO(VC-04): repair runs once PR #5's port lands on main.
              repairs: [],
              paused,
            })
          : [],
      };
    }),
    findings_needing_attention: findings.filter(
      (f) => f.certainty === "preliminary" || f.certainty === "contradictory" || !f.issueUrl,
    ).length,
    open_issues: findings.filter((f) => f.issueUrl).length,
    // TODO(VC-05): latest experiment summary once PR #6's port lands on main.
    latest_summary: null,
    // TODO(VC-04): repair runs once PR #5's port lands on main.
    repairs_by_status: {},
    signals_by_severity: {
      low: signals.filter((s) => s.severity === "low").length,
      medium: signals.filter((s) => s.severity === "medium").length,
      high: signals.filter((s) => s.severity === "high").length,
    },
    paused,
  };
}
