import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { participantDestination } from "@/domain/handoff";
import { redeemDirectLinkInvitation } from "@/domain/invitations";
import { resolveActor } from "@/lib/actor";
import { fail, json, parseBody, route, statusFor } from "@/lib/api";
import { issueAssignmentToken } from "@/lib/assignment-token";

const Body = z.object({ token: z.string().min(1) });

export const POST = route(async (req) => {
  const actor = await resolveActor(req);
  if (!actor) return fail(401, "unauthorized");
  const { token } = await parseBody(req, Body);
  const result = await redeemDirectLinkInvitation({ token, participantId: actor.participantId });
  if (!result.ok) return fail(statusFor(result.reason), result.reason);
  const product = await db.query.products.findFirst({
    where: eq(schema.products.id, result.assignment.productId),
  });
  if (!product) return fail(404, "not_found");
  const assignmentToken = await issueAssignmentToken({
    assignmentId: result.assignment.id,
    participantId: actor.participantId,
  });
  return json({
    assignment_id: result.assignment.id,
    destination: participantDestination({
      product,
      assignmentId: result.assignment.id,
      token: assignmentToken,
    }),
  });
});
