import { currentSession } from "@/auth/current-user";
import { deviceParticipant } from "@/domain/device-participants";
import { participantForUser } from "@/domain/participants";
import { ApiError } from "./api";
import { verifyAssignmentToken } from "./assignment-token";

export type Actor = {
  participantId: string;
  via: "session" | "assignment_token" | "device_token";
  assignmentId?: string;
};

/**
 * Who is acting: a signed-in user (cookie), an assignment token (dialog iframe, scoped to one
 * assignment), or a device token (anonymous embedded participant). Never a caller-supplied id.
 */
export async function resolveActor(req: Request): Promise<Actor | null> {
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) {
    const claims = await verifyAssignmentToken(bearer);
    if (claims)
      return {
        participantId: claims.participantId,
        via: "assignment_token",
        assignmentId: claims.assignmentId,
      };
    const device = await deviceParticipant(bearer);
    if (device) return { participantId: device.id, via: "device_token" };
    return null;
  }
  const session = await currentSession().catch(() => null);
  if (!session) return null;
  const participant = await participantForUser(session.user.id);
  return { participantId: participant.id, via: "session" };
}

/** For routes addressing one assignment: an assignment token must match that assignment. */
export async function requireParticipantFor(req: Request, assignmentId: string): Promise<Actor> {
  const actor = await resolveActor(req);
  if (!actor) throw new ApiError(401, "unauthorized");
  if (actor.assignmentId && actor.assignmentId !== assignmentId)
    throw new ApiError(403, "token_scope_mismatch");
  return actor;
}
