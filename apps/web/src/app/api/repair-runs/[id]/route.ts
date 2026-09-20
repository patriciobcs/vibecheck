import { getRepairRun } from "@/domain/repairs";
import { fail, json, route } from "@/lib/api";
import { requireTenantActor } from "@/lib/tenant-access";

export const GET = route(async (request, ctx: RouteContext<"/api/repair-runs/[id]">) => {
  const actor = await requireTenantActor(request);
  const { id } = await ctx.params;
  for (const tenantId of actor.tenantIds) {
    const result = await getRepairRun(id, tenantId);
    if (result) return json(result);
  }
  return fail(404, "not_found");
});
