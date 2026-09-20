import { createHash } from "node:crypto";
import { type StudyPlan, StudyPlanSchema } from "@vibecheck/contracts";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { type Db, db, schema, type Tx } from "@/db/client";
import { newId, newToken } from "@/lib/ids";
import { type AssignmentRow, type Channel, claimAssignmentIn } from "./assignments";
import { isInCooldown } from "./cooldown";

export type InvitationRow = typeof schema.invitations.$inferSelect;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/* ---------------- Direct link ---------------- */

export async function createDirectLinkInvitation(input: {
  studyId: string;
  createdByUserId: string;
  expiresInDays: number;
  maxUses?: number;
}): Promise<{ token: string; invitation: InvitationRow }> {
  const study = await db.query.studies.findFirst({ where: eq(schema.studies.id, input.studyId) });
  if (!study) throw new Error("study not found");
  const token = newToken(32);
  const [invitation] = await db
    .insert(schema.invitations)
    .values({
      id: newId("invitation"),
      tenantId: study.tenantId,
      studyId: study.id,
      studyRevision: study.currentRevision,
      tokenHash: hashToken(token),
      channel: "direct_link",
      maxUses: input.maxUses ?? null,
      expiresAt: new Date(Date.now() + input.expiresInDays * 86_400_000),
      createdByUserId: input.createdByUserId,
    })
    .returning();
  if (!invitation) throw new Error("invitation insert failed");
  return { token, invitation };
}

export type ResolveResult =
  | { ok: true; invitation: InvitationRow }
  | { ok: false; reason: "not_found" | "expired" };

export async function resolveInvitationToken(token: string): Promise<ResolveResult> {
  const invitation = await db.query.invitations.findFirst({
    where: eq(schema.invitations.tokenHash, hashToken(token)),
  });
  if (!invitation) return { ok: false, reason: "not_found" };
  if (invitation.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  return { ok: true, invitation };
}

export type RedeemResult =
  | { ok: true; assignment: AssignmentRow }
  | {
      ok: false;
      reason:
        | "not_found"
        | "expired"
        | "invitation_exhausted"
        | "study_full"
        | "paused"
        | "study_not_recruiting";
    };

/**
 * Exchanges a direct-link token for an assignment; the token never becomes a credential.
 * The use count and the claim commit together, so a failed claim never burns a use.
 */
export async function redeemDirectLinkInvitation(input: {
  token: string;
  participantId: string;
}): Promise<RedeemResult> {
  const resolved = await resolveInvitationToken(input.token);
  if (!resolved.ok) return resolved;
  const invitation = resolved.invitation;

  const existing = await db.query.assignments.findFirst({
    where: and(
      eq(schema.assignments.studyId, invitation.studyId),
      eq(schema.assignments.participantId, input.participantId),
    ),
  });
  if (existing) return { ok: true, assignment: existing };

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, invitation.id))
      .for("update");
    if (!row) return { ok: false, reason: "not_found" };
    if (row.maxUses !== null && row.uses >= row.maxUses)
      return { ok: false, reason: "invitation_exhausted" };
    const claim = await claimAssignmentIn(tx, {
      studyId: invitation.studyId,
      participantId: input.participantId,
      channel: "direct_link",
    });
    if (!claim.ok) return claim;
    if (claim.created) {
      await tx
        .update(schema.invitations)
        .set({ uses: row.uses + 1 })
        .where(eq(schema.invitations.id, row.id));
      await recordDelivery(
        {
          productId: claim.assignment.productId,
          studyId: invitation.studyId,
          participantId: input.participantId,
          channel: "direct_link",
          outcome: "accepted",
        },
        tx,
      );
    }
    return { ok: true, assignment: claim.assignment };
  });
}

/* ---------------- Deliveries and cooldown ---------------- */

export async function recordDelivery(
  input: {
    productId: string;
    studyId: string;
    participantId: string;
    channel: Channel;
    outcome: "shown" | "dismissed" | "accepted";
  },
  executor: Db | Tx = db,
) {
  const product = await executor.query.products.findFirst({
    where: eq(schema.products.id, input.productId),
  });
  if (!product) throw new Error("product not found");
  await executor.insert(schema.invitationDeliveries).values({
    id: newId("delivery"),
    tenantId: product.tenantId,
    productId: input.productId,
    studyId: input.studyId,
    participantId: input.participantId,
    channel: input.channel,
    outcome: input.outcome,
  });
}

/**
 * A dismissed embedded toast feeds the cooldown, so the study must belong to the product behind
 * the publishable key: a page cannot mark deliveries against products it does not represent.
 */
export async function recordEmbeddedDismissal(input: {
  publishableKey: string;
  studyId: string;
  participantId: string;
}): Promise<{ ok: true } | { ok: false; reason: "not_found" }> {
  const product = await db.query.products.findFirst({
    where: eq(schema.products.publishableKey, input.publishableKey),
  });
  if (!product) return { ok: false, reason: "not_found" };
  const study = await db.query.studies.findFirst({
    where: and(eq(schema.studies.id, input.studyId), eq(schema.studies.productId, product.id)),
  });
  if (!study) return { ok: false, reason: "not_found" };
  await recordDelivery({
    productId: product.id,
    studyId: study.id,
    participantId: input.participantId,
    channel: "embedded",
    outcome: "dismissed",
  });
  return { ok: true };
}

/* ---------------- Embedded SDK ---------------- */

export type EmbeddedStudyOffer = {
  studyId: string;
  productId: string;
  participantPrompt: string;
  estimatedSeconds: number;
  capture: { screen: string; microphone: string };
  scenario?: NonNullable<StudyPlan["task"]["scenario"]>;
};

export type EligibilityResult =
  | {
      ok: true;
      study: EmbeddedStudyOffer | null;
      reason?: "cooldown" | "no_open_study" | "paused" | "already_assigned";
    }
  | { ok: false; reason: "unknown_key" | "origin_not_permitted" };

/**
 * Embedded toast eligibility: publishable key must match the product, the page origin must be
 * explicitly permitted, the participant must be outside the cooldown, and a study must be recruiting
 * through the embedded channel.
 */
export async function checkEmbeddedEligibility(input: {
  publishableKey: string;
  origin: string;
  participantId: string | null;
}): Promise<EligibilityResult> {
  const product = await db.query.products.findFirst({
    where: eq(schema.products.publishableKey, input.publishableKey),
  });
  if (!product) return { ok: false, reason: "unknown_key" };
  if (!product.permittedOrigins.includes(input.origin))
    return { ok: false, reason: "origin_not_permitted" };

  const tenant = await db.query.tenants.findFirst({
    where: eq(schema.tenants.id, product.tenantId),
  });
  if (tenant?.paused) return { ok: true, study: null, reason: "paused" };

  if (input.participantId) {
    const last = await db.query.invitationDeliveries.findFirst({
      where: and(
        eq(schema.invitationDeliveries.participantId, input.participantId),
        eq(schema.invitationDeliveries.productId, product.id),
      ),
      orderBy: desc(schema.invitationDeliveries.createdAt),
    });
    if (
      isInCooldown({
        lastInvitedAt: last?.createdAt ?? null,
        now: new Date(),
        cooldownDays: product.invitationCooldownDays,
      })
    ) {
      return { ok: true, study: null, reason: "cooldown" };
    }
  }

  // Hot SDK path: open studies joined to their current revision in one query, recruiting first.
  const open = await db
    .select({ study: schema.studies, plan: schema.studyRevisions.plan })
    .from(schema.studies)
    .innerJoin(
      schema.studyRevisions,
      and(
        eq(schema.studyRevisions.studyId, schema.studies.id),
        eq(schema.studyRevisions.revision, schema.studies.currentRevision),
      ),
    )
    .where(
      and(
        eq(schema.studies.productId, product.id),
        inArray(schema.studies.status, ["recruiting", "published"]),
      ),
    )
    .orderBy(desc(sql`${schema.studies.status} = 'recruiting'`), desc(schema.studies.createdAt));
  const assigned = new Set(
    input.participantId
      ? (
          await db.query.assignments.findMany({
            where: and(
              eq(schema.assignments.participantId, input.participantId),
              inArray(
                schema.assignments.studyId,
                open.map((o) => o.study.id),
              ),
            ),
          })
        ).map((a) => a.studyId)
      : [],
  );
  for (const { study, plan: rawPlan } of open) {
    const plan = StudyPlanSchema.parse(rawPlan);
    if (plan.recruitment.source !== "embedded") continue;
    if (assigned.has(study.id)) continue;
    return {
      ok: true,
      study: {
        studyId: study.id,
        productId: product.id,
        participantPrompt: plan.task.participant_prompt,
        estimatedSeconds: plan.task.time_limit_seconds,
        capture: { screen: plan.capture.screen, microphone: plan.capture.microphone },
        scenario: plan.task.scenario,
      },
    };
  }
  return { ok: true, study: null, reason: "no_open_study" };
}
