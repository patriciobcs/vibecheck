import { listOperations } from "@/domain/operations";
import { json, route } from "@/lib/api";
import { requireTenantActor } from "@/lib/tenant-access";

export const GET = route(async (req) => {
  const actor = await requireTenantActor(req);
  return json(await listOperations(actor.tenantIds));
});
