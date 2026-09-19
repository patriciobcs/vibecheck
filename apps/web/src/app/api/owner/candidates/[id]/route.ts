import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";
import {
  acceptCandidate,
  dismissCandidate,
  linkCandidateToStudy,
} from "@/domain/monitoring/candidates";
import { createDiscoveryRun } from "@/domain/products";
import { fail, json, parseBody, requireSessionUser, route } from "@/lib/api";
import { env } from "@/lib/env";
import { requireTenantActor } from "@/lib/tenant-access";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("dismiss"), reason: z.string().min(1).max(500) }),
  z.object({ action: z.literal("accept") }),
  /** Ask discovery to turn the candidate into neutral task proposals (VC-01 rules still apply). */
  z.object({
    action: z.literal("request_task_proposal"),
    provider: z.enum(["fixture", "devin"]).optional(),
  }),
  z.object({ action: z.literal("link_study"), study_id: z.string().min(1) }),
]);

export const POST = route(async (req, ctx: RouteContext<"/api/owner/candidates/[id]">) => {
  const user = await requireSessionUser();
  const actor = await requireTenantActor(req);
  const { id } = await ctx.params;
  const candidate = await db.query.researchCandidates.findFirst({
    where: eq(schema.researchCandidates.id, id),
  });
  if (!candidate || !actor.tenantIds.includes(candidate.tenantId)) return fail(404, "not_found");
  const body = await parseBody(req, Body);
  switch (body.action) {
    case "dismiss":
      return json(await dismissCandidate(candidate.id, body.reason, user.id));
    case "accept":
      return json(await acceptCandidate(candidate.id, user.id));
    case "link_study": {
      await linkCandidateToStudy(candidate.id, body.study_id);
      return json({ ok: true });
    }
    case "request_task_proposal": {
      const provider = body.provider ?? env().DISCOVERY_PROVIDER;
      if (provider === "devin" && !env().devin) return fail(503, "devin_not_configured");
      await acceptCandidate(candidate.id, user.id);
      const run = await createDiscoveryRun(candidate.tenantId, candidate.productId, provider, {
        sourceCandidateRefs: [candidate.id],
      });
      if (!run) return fail(404, "not_found");
      return json({ discovery_run_id: run.id }, { status: 202 });
    }
  }
});
