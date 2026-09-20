import { jwtVerify, SignJWT } from "jose";
import { env } from "./env";

const secret = () => new TextEncoder().encode(env().BETTER_AUTH_SECRET);

/**
 * Short-lived token the recorder page hands to the embedded SDK (via validated postMessage)
 * so instrumented pages can post event batches for exactly one session.
 */
export async function issueEventsToken(input: {
  sessionId: string;
  participantId: string;
  ttlSeconds?: number;
}) {
  return new SignJWT({ sid: input.sessionId, pid: input.participantId, scope: "events" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${input.ttlSeconds ?? 60 * 60 * 3}s`)
    .sign(secret());
}

export async function verifyEventsToken(
  token: string,
): Promise<{ sessionId: string; participantId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (
      payload.scope !== "events" ||
      typeof payload.sid !== "string" ||
      typeof payload.pid !== "string"
    )
      return null;
    return { sessionId: payload.sid, participantId: payload.pid };
  } catch {
    return null;
  }
}

/** Observation-scoped ingestion credential for the passive SDK (one pseudonymous session, short-lived). */
export async function issueObservationToken(input: {
  observationSessionId: string;
  productId: string;
  ttlSeconds?: number;
}) {
  return new SignJWT({ oid: input.observationSessionId, prd: input.productId, scope: "observe" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${input.ttlSeconds ?? 60 * 60 * 12}s`)
    .sign(secret());
}

export async function verifyObservationToken(
  token: string,
): Promise<{ observationSessionId: string; productId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (
      payload.scope !== "observe" ||
      typeof payload.oid !== "string" ||
      typeof payload.prd !== "string"
    )
      return null;
    return { observationSessionId: payload.oid, productId: payload.prd };
  } catch {
    return null;
  }
}
