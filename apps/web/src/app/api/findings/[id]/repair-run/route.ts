import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { getRepairRun } from "@/domain/repairs";
import { fail, json, route } from "@/lib/api";
import { requireTenantActor } from "@/lib/tenant-access";

export const GET = route(async (request, ctx: RouteContext<"/api/findings/[id]/repair-run">) => {
  const actor = await requireTenantActor(request);
  const { id } = await ctx.params;
  for (const tenantId of actor.tenantIds) {
    const [run] = await db
      .select({ id: schema.repairRuns.id })
      .from(schema.repairRuns)
      .where(and(eq(schema.repairRuns.findingId, id), eq(schema.repairRuns.tenantId, tenantId)))
      .limit(1);
    if (run) {
      const result = await getRepairRun(run.id, tenantId);
      if (result) return json(result);
    }
  }
  return fail(404, "not_found");
});
