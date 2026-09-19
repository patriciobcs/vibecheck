import { ingestObservationBatch } from "@/domain/monitoring/ingest";
import { fail, json, route, statusFor } from "@/lib/api";
import { corsHeadersFor, preflight, withCors } from "@/lib/cors";
import { verifyObservationToken } from "@/lib/session-token";

export const OPTIONS = preflight;

/** Passive event batches: observation token scoped to one session, origin must be permitted, strict schema. */
export const POST = route(async (req) => {
  const cors = await corsHeadersFor(req.headers.get("x-vibecheck-key"), req.headers.get("origin"));
  if (!cors) return fail(403, "origin_not_permitted");
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const claims = await verifyObservationToken(token);
  if (!claims) return withCors(fail(401, "invalid_observation_token"), cors);
  const body = await req.text();
  if (body.length > 256 * 1024) return withCors(fail(413, "batch_too_large"), cors);
  const batch = JSON.parse(body || "null") as unknown;
  const result = await ingestObservationBatch({ sessionId: claims.observationSessionId, batch });
  if (!result.ok)
    return withCors(fail(statusFor(result.reason), result.reason, result.issues), cors);
  return withCors(json(result), cors);
});
