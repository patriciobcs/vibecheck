import { MonitoringPolicySchema } from "@vibecheck/contracts";
import { z } from "zod";
import { monitoringOverview } from "@/domain/monitoring/overview";
import { setMonitoringPolicy } from "@/domain/monitoring/policy";
import { ownerProduct } from "@/domain/owner-products";
import { fail, json, parseBody, requireSessionUser, route } from "@/lib/api";
import { requireTenantActor } from "@/lib/tenant-access";

export const GET = route(async (req, ctx: RouteContext<"/api/owner/products/[id]/monitoring">) => {
  const actor = await requireTenantActor(req);
  const { id } = await ctx.params;
  const product = await ownerProduct(actor.tenantIds, id);
  if (!product) return fail(404, "not_found");
  return json(await monitoringOverview(product.id));
});

const Patch = MonitoringPolicySchema.omit({ schema_version: true, policy_id: true })
  .partial()
  .strict();

/** Owner updates the monitoring policy; each change is a new immutable revision. */
export const PUT = route(async (req, ctx: RouteContext<"/api/owner/products/[id]/monitoring">) => {
  const user = await requireSessionUser();
  const actor = await requireTenantActor(req);
  const { id } = await ctx.params;
  const product = await ownerProduct(actor.tenantIds, id);
  if (!product) return fail(404, "not_found");
  const patch = await parseBody(req, Patch);
  return json(await setMonitoringPolicy(product.id, patch, user.id));
});

export { z };
