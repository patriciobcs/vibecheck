import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  analysisRun,
  experimentSummary,
  finding,
  participationEvent,
  product,
  repairRun,
  signal,
  study,
  studyPlanRevision,
} from "@/db/schema";
import { repoBindingSchema } from "@/contracts/repoBinding";
import { hasGithubCredentials } from "@/publishers/githubAuth";
import { studyStage } from "./timeline";

export async function productOverview(tenantId: string, productId: string) {
  const [productRow] = await db
    .select()
    .from(product)
    .where(and(eq(product.id, productId), eq(product.tenantId, tenantId)))
    .limit(1);
  if (!productRow) throw new Error("product_not_found");
  const binding = productRow.repoBinding ? repoBindingSchema.parse(productRow.repoBinding) : null;
  const studies = await db
    .select()
    .from(study)
    .where(and(eq(study.productId, productId), eq(study.tenantId, tenantId)))
    .orderBy(desc(study.createdAt));
  const studyIds = studies.map((row) => row.id);
  const plans = studyIds.length
    ? await db.select().from(studyPlanRevision).where(inArray(studyPlanRevision.studyId, studyIds))
    : [];
  const runs = studyIds.length
    ? await db
        .select()
        .from(analysisRun)
        .where(and(eq(analysisRun.tenantId, tenantId), inArray(analysisRun.studyId, studyIds)))
    : [];
  const participation = studyIds.length
    ? await db
        .select()
        .from(participationEvent)
        .where(
          and(
            eq(participationEvent.tenantId, tenantId),
            inArray(participationEvent.studyId, studyIds),
          ),
        )
    : [];
  const findings = studyIds.length
    ? await db
        .select()
        .from(finding)
        .where(and(eq(finding.tenantId, tenantId), inArray(finding.studyId, studyIds)))
    : [];
  const repairs = findings.length
    ? await db
        .select()
        .from(repairRun)
        .where(
          and(
            eq(repairRun.tenantId, tenantId),
            inArray(
              repairRun.findingId,
              findings.map((row) => row.id),
            ),
          ),
        )
    : [];
  const summaries = studyIds.length
    ? await db
        .select()
        .from(experimentSummary)
        .where(
          and(
            eq(experimentSummary.tenantId, tenantId),
            inArray(experimentSummary.studyId, studyIds),
          ),
        )
        .orderBy(desc(experimentSummary.revision))
    : [];
  const signals = await db
    .select()
    .from(signal)
    .where(and(eq(signal.tenantId, tenantId), eq(signal.productId, productId)));
  const latestPlan = plans
    .filter((row) => row.revision === studies[0]?.currentRevision)
    .find((row) => row.studyId === studies[0]?.id);
  const latestSummary = summaries[0];
  return {
    product: {
      id: productRow.id,
      name: productRow.name,
      url: productRow.url,
      repo_binding: binding
        ? binding.provider === "github"
          ? { kind: "github", repo: `${binding.owner}/${binding.repo}` }
          : { kind: "local", path: binding.path }
        : null,
      baseline_sha: latestPlan?.plan.baseline.commit_sha ?? null,
      connection:
        binding?.provider === "github"
          ? { healthy: hasGithubCredentials(), kind: "github" as const }
          : {
              healthy: Boolean(binding?.provider === "local" && binding.path),
              kind: "local" as const,
            },
    },
    studies: studies.map((row) => {
      const plan = plans.find(
        (item) => item.studyId === row.id && item.revision === row.currentRevision,
      );
      const summary = summaries.find(
        (item) =>
          item.studyId === row.id &&
          item.revision ===
            Math.max(...summaries.filter((s) => s.studyId === row.id).map((s) => s.revision)),
      );
      return {
        id: row.id,
        stage: plan
          ? studyStage(row, plan.plan, {
              analysisRuns: runs.filter((item) => item.studyId === row.id),
              participation: participation.filter((item) => item.studyId === row.id),
              findings: findings.filter((item) => item.studyId === row.id),
              summary: summary ? { status: summary.status } : null,
              repairs: repairs.filter((item) => item.studyId === row.id),
            })
          : [],
      };
    }),
    findings_needing_attention: findings.filter(
      (row) =>
        row.certainty === "preliminary" || row.certainty === "contradictory" || !row.issueUrl,
    ).length,
    open_issues: findings.filter((row) => row.issueUrl).length,
    repairs_by_status: Object.fromEntries(
      [...new Set(repairs.map((row) => row.status))].map((status) => [
        status,
        repairs.filter((row) => row.status === status).length,
      ]),
    ),
    latest_summary: latestSummary
      ? { headline: latestSummary.summary.narrative.headline, status: latestSummary.status }
      : null,
    signals_by_severity: {
      low: signals.filter((row) => row.severity === "low").length,
      medium: signals.filter((row) => row.severity === "medium").length,
      high: signals.filter((row) => row.severity === "high").length,
    },
  };
}
