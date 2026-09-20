import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { repairRun } from "@/db/schema";
import { tenantFromRequest, apiError } from "@/lib/auth";
import { getRepairRun } from "@/services/repairs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await tenantFromRequest(request);
  if (!tenantId) return apiError("authentication required", "unauthorized", 401);
  const [run] = await db
    .select({ id: repairRun.id })
    .from(repairRun)
    .where(and(eq(repairRun.findingId, (await params).id), eq(repairRun.tenantId, tenantId)))
    .limit(1);
  if (!run) return apiError("repair run not found", "not_found", 404);
  const result = await getRepairRun(run.id, tenantId);
  if (!result) return apiError("repair run not found", "not_found", 404);
  return Response.json(result);
}
