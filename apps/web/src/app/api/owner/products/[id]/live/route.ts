import { type LiveSessionRef, liveBoard } from "@/domain/monitoring/live";
import { ownerProduct } from "@/domain/owner-products";
import { fail, json, route } from "@/lib/api";
import { requireTenantActor } from "@/lib/tenant-access";

/** Polled by the live analysis board: persisted sessions, windows, evaluations, transcript. */
export const GET = route(async (req, ctx: RouteContext<"/api/owner/products/[id]/live">) => {
  const actor = await requireTenantActor(req);
  const { id } = await ctx.params;
  const product = await ownerProduct(actor.tenantIds, id);
  if (!product) return fail(404, "not_found");
  const params = new URL(req.url).searchParams;
  const kind = params.get("kind");
  const sessionId = params.get("session");
  let selected: LiveSessionRef | null = null;
  if (sessionId && (kind === "observation" || kind === "study")) selected = { kind, id: sessionId };
  return json(await liveBoard(product.id, selected), {
    headers: { "cache-control": "no-store" },
  });
});
