import { ingestEventBatch } from "@/domain/event-ingest";
import { fail, json, route, statusFor } from "@/lib/api";
import { corsHeadersFor, preflight, withCors } from "@/lib/cors";
import { verifyEventsToken } from "@/lib/session-token";

export const OPTIONS = preflight;

/** Event batches from instrumented pages. Bearer token scoped to one session; origin must be permitted. */
export const POST = route(async (req) => {
  const cors = await corsHeadersFor(req.headers.get("x-vibecheck-key"), req.headers.get("origin"));
  if (!cors) return fail(403, "origin_not_permitted");
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const claims = await verifyEventsToken(token);
  if (!claims) return withCors(fail(401, "invalid_events_token"), cors);
  const batch = (await req.json().catch(() => null)) as { session_id?: string } | null;
  if (!batch || batch.session_id !== claims.sessionId)
    return withCors(fail(403, "session_mismatch"), cors);
  const result = await ingestEventBatch({ participantId: claims.participantId, batch });
  if (!result.ok)
    return withCors(fail(statusFor(result.reason), result.reason, result.issues), cors);
  return withCors(json(result), cors);
});
