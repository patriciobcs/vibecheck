import { ArchiveCallbackSchema, handleArchiveCallback } from "@/domain/archive-pipeline";
import { fail, json, route } from "@/lib/api";
import { env } from "@/lib/env";
import { verifyArchiveCallback } from "@/providers/vonage";

/** Vonage archive status callback. Verified via the signature-secret JWT, then deduplicated. */
export const POST = route(async (req) => {
  const vonage = env().vonage;
  const rawBody = await req.text();
  const verification = await verifyArchiveCallback({
    authorization: req.headers.get("authorization"),
    secret: vonage?.archiveSignatureSecret ?? null,
    rawBody,
  });
  if (!verification.ok) {
    console.warn("rejected vonage callback", verification.reason);
    return fail(401, "callback_not_verified", verification.reason);
  }
  let body: unknown = null;
  try {
    body = JSON.parse(rawBody);
  } catch {}
  if (!body) return fail(400, "invalid_json");
  // A malformed body is a 4xx so the provider stops retrying something we can never process.
  const parsed = ArchiveCallbackSchema.safeParse(body);
  if (!parsed.success) return fail(400, "invalid_callback");
  const result = await handleArchiveCallback(parsed.data);
  return json(result);
});
