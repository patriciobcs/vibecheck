import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { fail, json, route } from "@/lib/api";
import { requireTenantActor } from "@/lib/tenant-access";

export const GET = route(async (req, ctx: RouteContext<"/api/analyses/[id]">) => {
  const actor = await requireTenantActor(req);
  const { id } = await ctx.params;
  const run = await db.query.analysisRuns.findFirst({
    where: and(
      eq(schema.analysisRuns.id, id),
      inArray(schema.analysisRuns.tenantId, actor.tenantIds),
    ),
  });
  if (!run) return fail(404, "not_found");
  const { rawResponses: _raw, ...safe } = run;
  return json(safe);
});
