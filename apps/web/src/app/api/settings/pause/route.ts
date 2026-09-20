import { inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { pauseTenant, resumeTenant } from "@/domain/tenant-pause";
import { json, parseBody, route } from "@/lib/api";
import { primaryTenant, requireTenantActor } from "@/lib/tenant-access";

const PauseBody = z.object({
  tenant_id: z.string().min(1).optional(),
  paused: z.boolean(),
  reason: z.string().max(500).nullable().optional(),
});

export const GET = route(async (req) => {
  const actor = await requireTenantActor(req);
  const rows = actor.tenantIds.length
    ? await db.query.tenants.findMany({
        where: inArray(schema.tenants.id, actor.tenantIds),
        columns: { id: true, paused: true, pausedAt: true },
      })
    : [];
  return json({
    tenants: rows.map((t) => ({
      tenant_id: t.id,
      paused: t.paused,
      paused_at: t.pausedAt?.toISOString() ?? null,
    })),
  });
});

export const POST = route(async (req) => {
  const actor = await requireTenantActor(req);
  const body = await parseBody(req, PauseBody);
  const tenantId = primaryTenant(actor, body.tenant_id ?? null);
  const result = body.paused
    ? await pauseTenant({ tenantId, actorUserId: actor.userId, reason: body.reason ?? null })
    : await resumeTenant({ tenantId, actorUserId: actor.userId });
  return json(result);
});
