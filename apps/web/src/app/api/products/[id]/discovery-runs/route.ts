import { z } from "zod";
import { createDiscoveryRun } from "@/domain/products";
import { fail, json, parseBody, route } from "@/lib/api";
import { env } from "@/lib/env";
import { requireTenantActor } from "@/lib/tenant-access";

const Body = z.object({
  provider: z.enum(["fixture", "devin"]).optional(),
  source_candidate_refs: z.array(z.string()).optional(),
});

/** VC-01: start a discovery run (queued; processed by the worker). */
export const POST = route(async (req, ctx: RouteContext<"/api/products/[id]/discovery-runs">) => {
  const actor = await requireTenantActor(req);
  const { id } = await ctx.params;
  const raw = await req.text();
  const body = await parseBody(
    new Request(req.url, {
      method: "POST",
      body: raw || "{}",
      headers: { "content-type": "application/json" },
    }),
    Body,
  );
  const provider = body.provider ?? env().DISCOVERY_PROVIDER;
  if (provider === "devin" && !env().devin)
    return fail(503, "devin_not_configured", "Set DEVIN_API_KEY to use the Devin provider.");
  let run = null;
  for (const tenantId of actor.tenantIds) {
    run = await createDiscoveryRun(tenantId, id, provider, {
      sourceCandidateRefs: body.source_candidate_refs,
    });
    if (run) break;
  }
  if (!run) return fail(404, "not_found");
  return json(run, { status: 202 });
});
