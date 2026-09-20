import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { buildSessionClockMap, buildSessionManifest } from "@/domain/manifest";
import { requireMembership } from "@/domain/owner";
import { fail, json, requireSessionUser, route } from "@/lib/api";

/** The VC-03 handoff for one session: manifest, clock map and the upload_verified event. Role-checked. */
export const GET = route(async (_req, ctx: RouteContext<"/api/owner/sessions/[id]/manifest">) => {
  const user = await requireSessionUser();
  const { id } = await ctx.params;
  const session = await db.query.sessions.findFirst({ where: eq(schema.sessions.id, id) });
  if (!session) return fail(404, "not_found");
  await requireMembership(user.id, session.tenantId);
  const manifest = await buildSessionManifest(id);
  const clockMap = await buildSessionClockMap(id);
  const event = await db.query.eventOutbox.findFirst({
    where: eq(schema.eventOutbox.idempotencyKey, `${id}:upload_verified`),
  });
  return json({ manifest, clock_map: clockMap, upload_verified_event: event?.envelope ?? null });
});
