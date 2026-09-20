import { jwtVerify, SignJWT } from "jose";
import { env } from "./env";

const secret = () => new TextEncoder().encode(env().BETTER_AUTH_SECRET);

/**
 * Bearer token scoped to one assignment. The embedded dialog (a cross-origin iframe that cannot
 * rely on cookies in every browser) uses it for every participant API call. It is handed to the
 * product page in a URL fragment, which browsers never send to servers.
 */
export async function issueAssignmentToken(input: {
  assignmentId: string;
  participantId: string;
  ttlSeconds?: number;
}) {
  return new SignJWT({ aid: input.assignmentId, pid: input.participantId, scope: "assignment" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${input.ttlSeconds ?? 60 * 60 * 24}s`)
    .sign(secret());
}

export async function verifyAssignmentToken(
  token: string,
): Promise<{ assignmentId: string; participantId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (
      payload.scope !== "assignment" ||
      typeof payload.aid !== "string" ||
      typeof payload.pid !== "string"
    )
      return null;
    return { assignmentId: payload.aid, participantId: payload.pid };
  } catch {
    return null;
  }
}
