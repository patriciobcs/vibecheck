import { z } from "zod";
import { currentSession } from "@/auth/current-user";
import { recordDelivery } from "@/domain/invitations";
import { participantForUser } from "@/domain/participants";
import { json, parseBody, route } from "@/lib/api";
import { corsHeadersFor, preflight, withCors } from "@/lib/cors";

const Body = z.object({
  publishable_key: z.string().min(1),
  study_id: z.string().min(1),
  product_id: z.string().min(1),
});

export const OPTIONS = preflight;

export const POST = route(async (req) => {
  const body = await parseBody(req, Body);
  const cors = await corsHeadersFor(body.publishable_key, req.headers.get("origin"));
  const session = await currentSession();
  if (session) {
    const participant = await participantForUser(session.user.id);
    await recordDelivery({
      productId: body.product_id,
      studyId: body.study_id,
      participantId: participant.id,
      channel: "embedded",
      outcome: "dismissed",
    });
  }
  return withCors(json({ ok: true }), cors);
});
