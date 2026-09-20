import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { requireMembership } from "@/domain/owner";
import { fail, json, requireSessionUser, route } from "@/lib/api";
import { storage } from "@/providers/storage";

/** Short-lived signed URLs for a session's verified media. Role-checked, never permanent. */
export const GET = route(async (_req, ctx: RouteContext<"/api/owner/sessions/[id]/media">) => {
  const user = await requireSessionUser();
  const { id } = await ctx.params;
  const session = await db.query.sessions.findFirst({ where: eq(schema.sessions.id, id) });
  if (!session) return fail(404, "not_found");
  await requireMembership(user.id, session.tenantId);
  const assets = await db.query.assets.findMany({ where: eq(schema.assets.sessionId, id) });
  const links = await Promise.all(
    assets
      .filter((a) => a.status === "verified" && a.storagePath)
      .map(async (a) => ({
        asset_id: a.id,
        offset_ms: a.offsetMs,
        duration_ms: a.durationMs,
        url: await storage().signedUrl(a.storagePath as string, 600),
        expires_in_seconds: 600,
      })),
  );
  return json({ media: links });
});
