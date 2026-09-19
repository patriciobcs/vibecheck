import { NextRequest } from "next/server";
import { tenantFromRequest, apiError } from "@/lib/auth";
import { db } from "@/db";
import { discoveryRun, product, proposal } from "@/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await tenantFromRequest(request);
  if (!tenantId) return apiError("authentication required", "unauthorized", 401);
  const [productRow] = await db
    .select()
    .from(product)
    .where(and(eq(product.id, (await params).id), eq(product.tenantId, tenantId)))
    .limit(1);
  if (!productRow) return apiError("product not found", "not_found", 404);
  const runs = await db
    .select()
    .from(discoveryRun)
    .where(and(eq(discoveryRun.productId, productRow.id), eq(discoveryRun.tenantId, tenantId)))
    .orderBy(desc(discoveryRun.createdAt));
  const proposals = runs.length
    ? await db
        .select()
        .from(proposal)
        .where(
          and(
            inArray(
              proposal.discoveryRunId,
              runs.map((run) => run.id),
            ),
            eq(proposal.tenantId, tenantId),
          ),
        )
    : [];
  return Response.json({
    ...productRow,
    discoveryRuns: runs.map((run) => ({
      ...run,
      proposals: proposals.filter((item) => item.discoveryRunId === run.id),
    })),
  });
}
