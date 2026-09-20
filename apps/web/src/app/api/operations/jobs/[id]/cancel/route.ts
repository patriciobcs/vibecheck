import { cancelJobAudited } from "@/domain/operations";
import { json, route } from "@/lib/api";
import { requireTenantActor } from "@/lib/tenant-access";

export const POST = route(async (req, ctx: RouteContext<"/api/operations/jobs/[id]/cancel">) => {
  const actor = await requireTenantActor(req);
  const { id } = await ctx.params;
  return json({
    job: await cancelJobAudited({
      tenantIds: actor.tenantIds,
      jobId: id,
      actorUserId: actor.userId,
    }),
  });
});
