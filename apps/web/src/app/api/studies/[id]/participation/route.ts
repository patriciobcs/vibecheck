import { ParticipationEventSchema } from "@vibecheck/contracts";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { recordParticipation } from "@/domain/participation";
import { fail, json, parseBody, route } from "@/lib/api";
import { requireTenantActor } from "@/lib/tenant-access";

export const POST = route(async (req, ctx: RouteContext<"/api/studies/[id]/participation">) => {
  const actor = await requireTenantActor(req);
  const { id } = await ctx.params;
  const event = await parseBody(req, ParticipationEventSchema);
  const study = await db.query.studies.findFirst({
    where: and(eq(schema.studies.id, id), inArray(schema.studies.tenantId, actor.tenantIds)),
  });
  if (!study) return fail(404, "study_not_found");
  return json(await recordParticipation(study.tenantId, id, event), { status: 201 });
});
