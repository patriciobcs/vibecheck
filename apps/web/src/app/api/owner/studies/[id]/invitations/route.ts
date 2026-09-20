import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { createDirectLinkInvitation } from "@/domain/invitations";
import { requireMembership } from "@/domain/owner";
import { fail, json, parseBody, requireSessionUser, route } from "@/lib/api";
import { env } from "@/lib/env";

const Body = z.object({
  expires_in_days: z.number().int().min(1).max(90).default(14),
  max_uses: z.number().int().positive().nullable().default(null),
});

export const POST = route(async (req, ctx: RouteContext<"/api/owner/studies/[id]/invitations">) => {
  const user = await requireSessionUser();
  const { id } = await ctx.params;
  const body = await parseBody(req, Body);
  const study = await db.query.studies.findFirst({ where: eq(schema.studies.id, id) });
  if (!study) return fail(404, "not_found");
  const tenant = await db.query.tenants.findFirst({ where: eq(schema.tenants.id, study.tenantId) });
  if (tenant?.paused) return fail(409, "paused");
  await requireMembership(user.id, study.tenantId, ["owner", "admin", "researcher"]);
  const { token, invitation } = await createDirectLinkInvitation({
    studyId: id,
    createdByUserId: user.id,
    expiresInDays: body.expires_in_days,
    maxUses: body.max_uses ?? undefined,
  });
  await db.insert(schema.auditEvents).values({
    id: `audit_${invitation.id}`,
    tenantId: study.tenantId,
    actorUserId: user.id,
    action: "invitation.created",
    subjectType: "invitation",
    subjectId: invitation.id,
    detail: {
      study_id: id,
      expires_at: invitation.expiresAt.toISOString(),
      max_uses: invitation.maxUses,
    },
  });
  return json({
    invitation_id: invitation.id,
    url: `${env().appUrl}/t/${token}`,
    expires_at: invitation.expiresAt.toISOString(),
  });
});
