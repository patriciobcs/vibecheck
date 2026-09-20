import { SignalSchema } from "@vibecheck/contracts";
import { ingestSignal, listSignals } from "@/domain/signals";
import { json, parseBody, route } from "@/lib/api";
import { requireTenantActor } from "@/lib/tenant-access";

export const GET = route(async (req, ctx: RouteContext<"/api/products/[id]/signals">) => {
  const actor = await requireTenantActor(req);
  const { id } = await ctx.params;
  return json({ signals: await listSignals(actor.tenantIds, id) });
});

export const POST = route(async (req, ctx: RouteContext<"/api/products/[id]/signals">) => {
  const actor = await requireTenantActor(req);
  const { id } = await ctx.params;
  const signal = await parseBody(req, SignalSchema);
  const result = await ingestSignal({
    tenantIds: actor.tenantIds,
    productId: id,
    signal,
    actorUserId: actor.userId,
  });
  return json(
    { outcome: result.outcome, signal: result.signal },
    { status: result.outcome === "created" ? 201 : 200 },
  );
});
