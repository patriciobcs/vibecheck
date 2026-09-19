import { assignmentViewForParticipant } from "@/domain/assignment-view";
import { requireParticipantFor } from "@/lib/actor";
import { fail, json, route } from "@/lib/api";

export const GET = route(async (req, ctx: RouteContext<"/api/assignments/[id]">) => {
  const { id } = await ctx.params;
  const actor = await requireParticipantFor(req, id);
  const view = await assignmentViewForParticipant(actor.participantId, id);
  if (!view) return fail(404, "not_found");
  return json(view);
});
