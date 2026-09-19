import { NextRequest } from "next/server";
import { tenantFromRequest, apiError } from "@/lib/auth";
import { db } from "@/db";
import { analysisRun } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await tenantFromRequest(request);
  if (!tenantId) return apiError("authentication required", "unauthorized", 401);
  const [run] = await db
    .select()
    .from(analysisRun)
    .where(and(eq(analysisRun.id, (await params).id), eq(analysisRun.tenantId, tenantId)))
    .limit(1);
  if (!run) return apiError("analysis not found", "not_found", 404);
  return Response.json(run);
}
