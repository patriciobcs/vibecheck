import { NextRequest } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { tenantFromRequest, apiError } from "@/lib/auth";
import { db } from "@/db";
import {
  analysisRun,
  experimentSummary,
  finding,
  participationEvent,
  repairRun,
  study,
  studyPlanRevision,
  tenant,
} from "@/db/schema";
import { studyStage } from "@/services/timeline";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await tenantFromRequest(request);
  if (!tenantId) return apiError("authentication required", "unauthorized", 401);
  const studyId = (await params).id;
  const [studyRow] = await db
    .select()
    .from(study)
    .where(and(eq(study.id, studyId), eq(study.tenantId, tenantId)))
    .limit(1);
  if (!studyRow) return apiError("study not found", "not_found", 404);
  const [planRow] = await db
    .select()
    .from(studyPlanRevision)
    .where(
      and(
        eq(studyPlanRevision.studyId, studyId),
        eq(studyPlanRevision.revision, studyRow.currentRevision),
      ),
    )
    .limit(1);
  if (!planRow) return apiError("study plan not found", "not_found", 404);
  const [summary] = await db
    .select()
    .from(experimentSummary)
    .where(and(eq(experimentSummary.studyId, studyId), eq(experimentSummary.tenantId, tenantId)))
    .orderBy(desc(experimentSummary.revision))
    .limit(1);
  const [paused] = await db
    .select({ pausedAt: tenant.pausedAt })
    .from(tenant)
    .where(eq(tenant.id, tenantId))
    .limit(1);
  const repairs = await db
    .select()
    .from(repairRun)
    .where(and(eq(repairRun.studyId, studyId), eq(repairRun.tenantId, tenantId)));
  const [runs, participation, findings] = await Promise.all([
    db
      .select()
      .from(analysisRun)
      .where(and(eq(analysisRun.studyId, studyId), eq(analysisRun.tenantId, tenantId))),
    db
      .select()
      .from(participationEvent)
      .where(
        and(eq(participationEvent.studyId, studyId), eq(participationEvent.tenantId, tenantId)),
      ),
    db
      .select()
      .from(finding)
      .where(and(eq(finding.studyId, studyId), eq(finding.tenantId, tenantId))),
  ]);
  return Response.json({
    stages: studyStage(studyRow, planRow.plan, {
      analysisRuns: runs,
      participation,
      findings,
      summary: summary ? { status: summary.status } : null,
      repairs,
      paused: Boolean(paused?.pausedAt),
    }),
  });
}
