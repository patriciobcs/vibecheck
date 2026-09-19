import { z } from "zod";
import { openObservationSession } from "@/domain/monitoring/ingest";
import { fail, json, parseBody, route } from "@/lib/api";
import { corsHeadersFor, preflight, withCors } from "@/lib/cors";
import { issueObservationToken } from "@/lib/session-token";

const Body = z.object({
  publishable_key: z.string().min(1),
  build_ref: z.string().min(1).max(120).default("unknown"),
  collection_permission: z.enum(["granted", "denied", "unknown"]).default("unknown"),
  instrumentation_schema_version: z.string().max(20).optional(),
});

export const OPTIONS = preflight;

/** Opens a pseudonymous passive observation session; refused unless monitoring is on and permission is granted. */
export const POST = route(async (req) => {
  const body = await parseBody(req, Body);
  const origin = req.headers.get("origin") ?? "";
  const cors = await corsHeadersFor(body.publishable_key, origin);
  const result = await openObservationSession({
    publishableKey: body.publishable_key,
    origin,
    buildRef: body.build_ref,
    collectionPermission: body.collection_permission,
    instrumentationSchemaVersion: body.instrumentation_schema_version,
  });
  if (!result.ok)
    return withCors(
      fail(
        result.reason === "unknown_key"
          ? 404
          : result.reason === "origin_not_permitted"
            ? 403
            : 409,
        result.reason,
      ),
      cors,
    );
  const token = await issueObservationToken({
    observationSessionId: result.sessionId,
    productId: result.productId,
  });
  return withCors(
    json({
      session_id: result.sessionId,
      token,
      batch_delay_ms: result.batchDelayMs,
      policy_ref: result.policyRef,
    }),
    cors,
  );
});
