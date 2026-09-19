import { eq } from "drizzle-orm";
import { currentSession } from "@/auth/current-user";
import { db, schema } from "@/db/client";
import { membershipsForUser } from "@/domain/participants";
import { ApiError } from "./api";

import { hashApiKey } from "./api-key";

export { hashApiKey };

export type TenantActor = {
  tenantIds: string[];
  via: "api_key" | "session";
  userId: string | null;
};

/**
 * Owner-side access (VC-01 endpoints): a hashed API key (`Authorization: Bearer`) resolves to one
 * tenant; a signed-in user resolves to the tenants they are a member of. Never a caller-supplied id.
 */
export async function resolveTenantActor(req: Request): Promise<TenantActor | null> {
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) {
    const key = await db.query.apiKeys.findFirst({
      where: eq(schema.apiKeys.keyHash, hashApiKey(bearer)),
    });
    return key ? { tenantIds: [key.tenantId], via: "api_key", userId: null } : null;
  }
  const session = await currentSession().catch(() => null);
  if (!session) return null;
  const memberships = await membershipsForUser(session.user.id);
  return { tenantIds: memberships.map((m) => m.tenantId), via: "session", userId: session.user.id };
}

export async function requireTenantActor(req: Request): Promise<TenantActor> {
  const actor = await resolveTenantActor(req);
  if (!actor) throw new ApiError(401, "unauthorized");
  return actor;
}

/** The tenant a create-style request acts for: the API key's tenant, or the session's first membership. */
export function primaryTenant(actor: TenantActor): string {
  const id = actor.tenantIds[0];
  if (!id) throw new ApiError(403, "no_tenant");
  return id;
}
