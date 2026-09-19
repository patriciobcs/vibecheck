import { handleArchiveCallback } from "@/domain/archive-pipeline";
import { fail, json, route } from "@/lib/api";
import { env } from "@/lib/env";
import { verifyArchiveCallback } from "@/providers/vonage";

/** Vonage archive status callback. Verified via the signature-secret JWT, then deduplicated. */
export const POST = route(async (req) => {
  const verification = await verifyArchiveCallback({
    authorization: req.headers.get("authorization"),
    secret: env().vonage?.archiveSignatureSecret ?? null,
  });
  if (!verification.ok) {
    console.warn("rejected vonage callback", verification.reason);
    return fail(401, "callback_not_verified", verification.reason);
  }
  const body = await req.json().catch(() => null);
  if (!body) return fail(400, "invalid_json");
  const result = await handleArchiveCallback(body);
  return json(result);
});
