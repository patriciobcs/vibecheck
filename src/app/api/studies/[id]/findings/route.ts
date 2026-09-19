import { NextRequest } from "next/server";
import { tenantFromRequest, apiError } from "@/lib/auth";
import { db } from "@/db";
import { finding, study } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await tenantFromRequest(request);
  if (!tenantId) return apiError("authentication required", "unauthorized", 401);
  const [studyRow] = await db
    .select({ id: study.id })
    .from(study)
    .where(and(eq(study.id, (await params).id), eq(study.tenantId, tenantId)))
    .limit(1);
  if (!studyRow) return apiError("study not found", "not_found", 404);
  const findings = await db
    .select()
    .from(finding)
    .where(and(eq(finding.studyId, studyRow.id), eq(finding.tenantId, tenantId)));
  return Response.json(findings);
}
