import { productOverview } from "@/domain/overview";
import { fail, json, route } from "@/lib/api";
import { requireTenantActor } from "@/lib/tenant-access";

export const GET = route(async (req, ctx: RouteContext<"/api/products/[id]/overview">) => {
  const actor = await requireTenantActor(req);
  const { id } = await ctx.params;
  const overview = await productOverview(actor.tenantIds, id);
  if (!overview) return fail(404, "not_found");
  return json(overview);
});
