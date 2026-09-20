import { z } from "zod";
import { currentSession } from "@/auth/current-user";
import { recordEmbeddedDismissal } from "@/domain/invitations";
import { participantForUser } from "@/domain/participants";
import { fail, json, parseBody, route } from "@/lib/api";
import { corsHeadersFor, preflight, withCors } from "@/lib/cors";

const Body = z.object({ publishable_key: z.string().min(1), study_id: z.string().min(1) });

export const OPTIONS = preflight;

/** Toast dismissed on the product page. The product is the one behind the key, never a body field. */
export const POST = route(async (req) => {
  const body = await parseBody(req, Body);
  const cors = await corsHeadersFor(body.publishable_key, req.headers.get("origin"));
  if (!cors) return fail(403, "origin_not_permitted");
  const session = await currentSession().catch(() => null);
  if (session) {
    const participant = await participantForUser(session.user.id);
    const result = await recordEmbeddedDismissal({
      publishableKey: body.publishable_key,
      studyId: body.study_id,
      participantId: participant.id,
    });
    if (!result.ok) return withCors(fail(404, result.reason), cors);
  }
  return withCors(json({ ok: true }), cors);
});
