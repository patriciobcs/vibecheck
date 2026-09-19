import { NextRequest } from "next/server";
import { tenantFromRequest, apiError } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await tenantFromRequest(request);
  if (!tenantId) return apiError("authentication required", "unauthorized", 401);
  const study = await prisma.study.findFirst({ where: { id: (await params).id, tenantId }, include: { revisions: true, publishRequests: true } });
  if (!study) return apiError("study not found", "not_found", 404);
  const event = await prisma.outboxEvent.findFirst({ where: { correlationId: study.id, tenantId } });
  return Response.json({ ...study, event });
}
