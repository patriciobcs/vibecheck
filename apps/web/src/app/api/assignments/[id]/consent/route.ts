import { z } from "zod";
import { recordConsent } from "@/domain/sessions";
import { requireParticipantFor } from "@/lib/actor";
import { fail, json, parseBody, route, statusFor } from "@/lib/api";

const Body = z.object({ consent_version: z.string().min(1) });

export const POST = route(async (req, ctx: RouteContext<"/api/assignments/[id]/consent">) => {
  const { id } = await ctx.params;
  const actor = await requireParticipantFor(req, id);
  const body = await parseBody(req, Body);
  const result = await recordConsent({
    assignmentId: id,
    participantId: actor.participantId,
    consentVersion: body.consent_version,
  });
  if (!result.ok) return fail(statusFor(result.reason), result.reason);
  return json({ ok: true });
});
