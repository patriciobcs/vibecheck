import { NextRequest } from "next/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { tenantFromRequest, apiError } from "@/lib/auth";
import { db } from "@/db";
import { experimentSummary, study } from "@/db/schema";
import { enqueueSummary } from "@/services/summaries";

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
  const [latest] = await db
    .select()
    .from(experimentSummary)
    .where(and(eq(experimentSummary.studyId, studyId), eq(experimentSummary.tenantId, tenantId)))
    .orderBy(desc(experimentSummary.revision))
    .limit(1);
  if (!latest) return apiError("summary not found", "not_found", 404);
  const revisions = await db
    .select({
      revision: experimentSummary.revision,
      status: experimentSummary.status,
      generated_at: experimentSummary.createdAt,
    })
    .from(experimentSummary)
    .where(and(eq(experimentSummary.studyId, studyId), eq(experimentSummary.tenantId, tenantId)))
    .orderBy(asc(experimentSummary.revision));
  return Response.json({
    ...latest.summary,
    revisions: revisions.map((row) => ({ ...row, generated_at: row.generated_at.toISOString() })),
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await tenantFromRequest(request);
  if (!tenantId) return apiError("authentication required", "unauthorized", 401);
  const studyId = (await params).id;
  const [studyRow] = await db
    .select({
      id: study.id,
      tenantId: study.tenantId,
      currentRevision: study.currentRevision,
      status: study.status,
    })
    .from(study)
    .where(and(eq(study.id, studyId), eq(study.tenantId, tenantId)))
    .limit(1);
  if (!studyRow) return apiError("study not found", "not_found", 404);
  if (studyRow.status !== "published") return apiError("study not published", "invalid_state", 422);
  await db.transaction((tx) => enqueueSummary(tx, tenantId, studyId, studyRow.currentRevision));
  return new Response(null, { status: 202 });
}
