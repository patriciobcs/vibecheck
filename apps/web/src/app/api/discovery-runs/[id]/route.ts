import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { fail, json, route } from "@/lib/api";
import { requireTenantActor } from "@/lib/tenant-access";

export const GET = route(async (req, ctx: RouteContext<"/api/discovery-runs/[id]">) => {
  const actor = await requireTenantActor(req);
  const { id } = await ctx.params;
  const run = await db.query.discoveryRuns.findFirst({
    where: and(
      eq(schema.discoveryRuns.id, id),
      inArray(schema.discoveryRuns.tenantId, actor.tenantIds),
    ),
  });
  if (!run) return fail(404, "not_found");
  const proposals = await db.query.proposals.findMany({
    where: eq(schema.proposals.discoveryRunId, run.id),
  });
  // Raw agent responses stay server-side (restricted debugging), never in the API response.
  const { rawResponses: _raw, ...safe } = run;
  return json({ ...safe, proposals });
});
