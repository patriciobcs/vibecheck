import { studyTimeline } from "@/domain/timeline";
import { fail, json, route } from "@/lib/api";
import { requireTenantActor } from "@/lib/tenant-access";

export const GET = route(async (req, ctx: RouteContext<"/api/studies/[id]/timeline">) => {
  const actor = await requireTenantActor(req);
  const { id } = await ctx.params;
  const timeline = await studyTimeline(actor.tenantIds, id);
  if (!timeline) return fail(404, "not_found");
  return json(timeline);
});
