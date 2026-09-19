import { ingestEventBatch } from "@/domain/event-ingest";
import { requireParticipantFor } from "@/lib/actor";
import { fail, json, route, statusFor } from "@/lib/api";

/** Events from the dialog itself (task markers, moderation prompts). Cookie or assignment token. */
export const POST = route(async (req, ctx: RouteContext<"/api/assignments/[id]/events">) => {
  const { id } = await ctx.params;
  const actor = await requireParticipantFor(req, id);
  const batch = await req.json().catch(() => null);
  const result = await ingestEventBatch({ participantId: actor.participantId, batch });
  if (!result.ok) return fail(statusFor(result.reason), result.reason, result.issues);
  return json(result);
});
