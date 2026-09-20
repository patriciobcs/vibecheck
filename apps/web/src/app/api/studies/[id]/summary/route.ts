import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { enqueueSummary, latestSummary } from "@/domain/summaries";
import { fail, json, route } from "@/lib/api";
import { requireTenantActor } from "@/lib/tenant-access";

export const GET = route(async (req, ctx: RouteContext<"/api/studies/[id]/summary">) => {
  const actor = await requireTenantActor(req);
  const { id } = await ctx.params;
  const study = await db.query.studies.findFirst({
    where: and(eq(schema.studies.id, id), inArray(schema.studies.tenantId, actor.tenantIds)),
  });
  if (!study) return fail(404, "study_not_found");
  const result = await latestSummary(study.tenantId, id);
  if (!result.latest) return fail(404, "summary_not_found");
  return json({ ...result.latest.summary, revisions: result.revisions });
});

export const POST = route(async (req, ctx: RouteContext<"/api/studies/[id]/summary">) => {
  const actor = await requireTenantActor(req);
  const { id } = await ctx.params;
  const study = await db.query.studies.findFirst({
    where: and(eq(schema.studies.id, id), inArray(schema.studies.tenantId, actor.tenantIds)),
  });
  if (!study) return fail(404, "study_not_found");
  if (study.status === "draft") return fail(422, "study_not_published");
  await db.transaction((tx) => enqueueSummary(tx, study.tenantId, id, study.currentRevision));
  return json({ queued: true }, { status: 202 });
});
