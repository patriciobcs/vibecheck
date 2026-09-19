import { resolveActor } from "@/lib/actor";
import { fail, json, route } from "@/lib/api";

/** Resolves an assignment token to its assignment id, so the dialog never decodes tokens itself. */
export const GET = route(async (req) => {
  const actor = await resolveActor(req);
  if (!actor?.assignmentId) return fail(401, "unauthorized");
  return json({ assignment_id: actor.assignmentId });
});
