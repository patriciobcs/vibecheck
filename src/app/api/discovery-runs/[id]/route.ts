import { NextRequest } from "next/server";
import { tenantFromRequest, apiError } from "@/lib/auth";
import { db } from "@/db";
import { discoveryRun, proposal } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await tenantFromRequest(request);
  if (!tenantId) return apiError("authentication required", "unauthorized", 401);
  const [run] = await db
    .select()
    .from(discoveryRun)
    .where(and(eq(discoveryRun.id, (await params).id), eq(discoveryRun.tenantId, tenantId)))
    .limit(1);
  if (!run) return apiError("discovery run not found", "not_found", 404);
  const proposals = await db
    .select()
    .from(proposal)
    .where(and(eq(proposal.discoveryRunId, run.id), eq(proposal.tenantId, tenantId)));
  return Response.json({ ...run, proposals });
}
