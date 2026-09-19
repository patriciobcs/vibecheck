import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { fail, json, route } from "@/lib/api";
import { requireTenantActor } from "@/lib/tenant-access";

export const GET = route(async (req, ctx: RouteContext<"/api/products/[id]">) => {
  const actor = await requireTenantActor(req);
  const { id } = await ctx.params;
  const product = await db.query.products.findFirst({
    where: and(eq(schema.products.id, id), inArray(schema.products.tenantId, actor.tenantIds)),
  });
  if (!product) return fail(404, "not_found");
  const runs = await db.query.discoveryRuns.findMany({
    where: eq(schema.discoveryRuns.productId, product.id),
    orderBy: desc(schema.discoveryRuns.createdAt),
  });
  const proposals = runs.length
    ? await db.query.proposals.findMany({
        where: inArray(
          schema.proposals.discoveryRunId,
          runs.map((r) => r.id),
        ),
      })
    : [];
  return json({
    ...product,
    discoveryRuns: runs.map(({ rawResponses: _raw, ...run }) => ({
      ...run,
      proposals: proposals.filter((p) => p.discoveryRunId === run.id),
    })),
  });
});
