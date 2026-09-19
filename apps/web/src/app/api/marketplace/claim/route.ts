import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { claimAssignment } from "@/domain/assignments";
import { participantDestination } from "@/domain/handoff";
import { recordDelivery } from "@/domain/invitations";
import { resolveActor } from "@/lib/actor";
import { fail, json, parseBody, route, statusFor } from "@/lib/api";
import { issueAssignmentToken } from "@/lib/assignment-token";

const Body = z.object({ study_id: z.string().min(1) });

export const POST = route(async (req) => {
  const actor = await resolveActor(req);
  if (!actor) return fail(401, "unauthorized");
  const { study_id } = await parseBody(req, Body);
  const result = await claimAssignment({
    studyId: study_id,
    participantId: actor.participantId,
    channel: "marketplace",
  });
  if (!result.ok) return fail(statusFor(result.reason), result.reason);
  if (result.created) {
    await recordDelivery({
      productId: result.assignment.productId,
      studyId: study_id,
      participantId: actor.participantId,
      channel: "marketplace",
      outcome: "accepted",
    });
  }
  const product = await db.query.products.findFirst({
    where: eq(schema.products.id, result.assignment.productId),
  });
  if (!product) return fail(404, "not_found");
  const token = await issueAssignmentToken({
    assignmentId: result.assignment.id,
    participantId: actor.participantId,
  });
  return json({
    assignment_id: result.assignment.id,
    created: result.created,
    destination: participantDestination({ product, assignmentId: result.assignment.id, token }),
  });
});
