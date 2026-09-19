import { NextRequest } from "next/server";
import { tenantFromRequest, apiError } from "@/lib/auth";
import { db } from "@/db";
import { outboxEvent, study, studyPlanRevision } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await tenantFromRequest(request);
  if (!tenantId) return apiError("authentication required", "unauthorized", 401);
  const [studyRow] = await db
    .select()
    .from(study)
    .where(and(eq(study.id, (await params).id), eq(study.tenantId, tenantId)))
    .limit(1);
  if (!studyRow) return apiError("study not found", "not_found", 404);
  const [revision] = await db
    .select()
    .from(studyPlanRevision)
    .where(
      and(
        eq(studyPlanRevision.studyId, studyRow.id),
        eq(studyPlanRevision.revision, studyRow.currentRevision),
      ),
    )
    .limit(1);
  const [event] = await db
    .select()
    .from(outboxEvent)
    .where(and(eq(outboxEvent.correlationId, studyRow.id), eq(outboxEvent.tenantId, tenantId)))
    .limit(1);
  return Response.json({ ...studyRow, revisions: revision ? [revision] : [], event });
}
