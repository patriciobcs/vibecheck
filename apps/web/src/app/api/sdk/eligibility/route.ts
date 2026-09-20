import { z } from "zod";
import { currentSession } from "@/auth/current-user";
import { checkEmbeddedEligibility, recordDelivery } from "@/domain/invitations";
import { participantForUser } from "@/domain/participants";
import { fail, json, parseBody, route, statusFor } from "@/lib/api";
import { corsHeadersFor, preflight, withCors } from "@/lib/cors";

const Body = z.object({ publishable_key: z.string().min(1) });

export const OPTIONS = preflight;

/**
 * Called by the embedded SDK from the product's page. The browser's Origin header is the
 * origin check; a signed-in participant (same-site cookie) enables the server-side cooldown.
 */
export const POST = route(async (req) => {
  const body = await parseBody(req, Body);
  const origin = req.headers.get("origin");
  const cors = await corsHeadersFor(body.publishable_key, origin);
  const session = await currentSession();
  const participant = session ? await participantForUser(session.user.id) : null;
  const result = await checkEmbeddedEligibility({
    publishableKey: body.publishable_key,
    origin: origin ?? "",
    participantId: participant?.id ?? null,
  });
  if (!result.ok) return withCors(fail(statusFor(result.reason), result.reason), cors);
  if (result.study && participant) {
    await recordDelivery({
      productId: result.study.productId,
      studyId: result.study.studyId,
      participantId: participant.id,
      channel: "embedded",
      outcome: "shown",
    });
  }
  return withCors(
    json({ study: result.study, reason: result.reason ?? null, signed_in: participant !== null }),
    cors,
  );
});
