import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { startAnalysis } from "@/domain/analyses";
import { fail, json, parseBody, route } from "@/lib/api";
import { env } from "@/lib/env";
import { requireTenantActor } from "@/lib/tenant-access";

const Body = z.object({
  session_id: z.string().min(1),
  provider: z.enum(["fixture", "devin"]).optional(),
});

export const GET = route(async (req, ctx: RouteContext<"/api/studies/[id]/analyses">) => {
  const actor = await requireTenantActor(req);
  const { id } = await ctx.params;
  const runs = await Promise.all(
    actor.tenantIds.map((tenantId) =>
      db.query.analysisRuns.findMany({
        where: and(eq(schema.analysisRuns.studyId, id), eq(schema.analysisRuns.tenantId, tenantId)),
      }),
    ),
  );
  return json(runs.flat());
});

export const POST = route(async (req, ctx: RouteContext<"/api/studies/[id]/analyses">) => {
  const actor = await requireTenantActor(req);
  const { id } = await ctx.params;
  const input = await parseBody(req, Body);
  const provider = input.provider ?? env().DISCOVERY_PROVIDER;
  for (const tenantId of actor.tenantIds) {
    const result = await startAnalysis(tenantId, id, input.session_id, provider);
    if (result) return json(result, { status: result.status });
  }
  return fail(404, "not_found");
});
