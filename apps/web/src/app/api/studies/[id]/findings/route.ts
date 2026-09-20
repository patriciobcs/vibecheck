import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { fail, json, route } from "@/lib/api";
import { requireTenantActor } from "@/lib/tenant-access";

export const GET = route(async (req, ctx: RouteContext<"/api/studies/[id]/findings">) => {
  const actor = await requireTenantActor(req);
  const { id } = await ctx.params;
  const study = await db.query.studies.findFirst({
    where: and(eq(schema.studies.id, id), inArray(schema.studies.tenantId, actor.tenantIds)),
  });
  if (!study) return fail(404, "not_found");
  return json(
    await db.query.findings.findMany({
      where: and(
        eq(schema.findings.studyId, id),
        inArray(schema.findings.tenantId, actor.tenantIds),
      ),
    }),
  );
});
