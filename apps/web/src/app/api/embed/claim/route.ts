import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { claimAssignment } from "@/domain/assignments";
import { recordDelivery } from "@/domain/invitations";
import { resolveActor } from "@/lib/actor";
import { fail, json, parseBody, route, statusFor } from "@/lib/api";
import { issueAssignmentToken } from "@/lib/assignment-token";

const Body = z.object({ study_id: z.string().min(1), publishable_key: z.string().min(1) });

/** Embedded channel claim: device (or signed-in) participant + publishable key → assignment token. */
export const POST = route(async (req) => {
  const actor = await resolveActor(req);
  if (!actor) return fail(401, "unauthorized");
  const body = await parseBody(req, Body);
  const study = await db.query.studies.findFirst({ where: eq(schema.studies.id, body.study_id) });
  if (!study) return fail(404, "not_found");
  const product = await db.query.products.findFirst({
    where: eq(schema.products.id, study.productId),
  });
  if (!product || product.publishableKey !== body.publishable_key) return fail(404, "not_found");
  const result = await claimAssignment({
    studyId: study.id,
    participantId: actor.participantId,
    channel: "embedded",
  });
  if (!result.ok) return fail(statusFor(result.reason), result.reason);
  if (result.created) {
    await recordDelivery({
      productId: product.id,
      studyId: study.id,
      participantId: actor.participantId,
      channel: "embedded",
      outcome: "accepted",
    });
  }
  const token = await issueAssignmentToken({
    assignmentId: result.assignment.id,
    participantId: actor.participantId,
  });
  return json({ assignment_id: result.assignment.id, assignment_token: token });
});
