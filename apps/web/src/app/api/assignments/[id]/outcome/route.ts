import { z } from "zod";
import { submitOutcome } from "@/domain/sessions";
import { requireParticipantFor } from "@/lib/actor";
import { fail, json, parseBody, route, statusFor } from "@/lib/api";

const Body = z.object({
  participant_reported: z.enum(["completed", "stuck", "gave_up"]),
  perceived_difficulty: z.number().int().min(1).max(5),
  comments: z.string().max(2000).nullable(),
});

export const POST = route(async (req, ctx: RouteContext<"/api/assignments/[id]/outcome">) => {
  const { id } = await ctx.params;
  const actor = await requireParticipantFor(req, id);
  const body = await parseBody(req, Body);
  const result = await submitOutcome({
    assignmentId: id,
    participantId: actor.participantId,
    participantReported: body.participant_reported,
    perceivedDifficulty: body.perceived_difficulty,
    comments: body.comments,
  });
  if (!result.ok) return fail(statusFor(result.reason), result.reason);
  return json({ ok: true });
});
