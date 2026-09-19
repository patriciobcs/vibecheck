import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { fail, json, route } from "@/lib/api";
import { requireTenantActor } from "@/lib/tenant-access";

export const GET = route(async (req, ctx: RouteContext<"/api/studies/[id]">) => {
  const actor = await requireTenantActor(req);
  const { id } = await ctx.params;
  const study = await db.query.studies.findFirst({
    where: and(eq(schema.studies.id, id), inArray(schema.studies.tenantId, actor.tenantIds)),
  });
  if (!study) return fail(404, "not_found");
  const revision = await db.query.studyRevisions.findFirst({
    where: and(
      eq(schema.studyRevisions.studyId, study.id),
      eq(schema.studyRevisions.revision, study.currentRevision),
    ),
  });
  const event = await db.query.eventOutbox.findFirst({
    where: eq(
      schema.eventOutbox.idempotencyKey,
      `${study.id}:revision_${study.currentRevision}:publish`,
    ),
  });
  return json({ ...study, revisions: revision ? [revision] : [], event: event?.envelope ?? null });
});
