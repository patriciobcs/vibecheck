import { createHash } from "node:crypto";
import { StudyPlanSchema } from "@vibecheck/contracts";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { newId, newToken } from "@/lib/ids";
import { type AssignmentRow, type Channel, claimAssignment } from "./assignments";
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

/** Exchanges a direct-link token for an assignment; the token never becomes a credential. */
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

  const reserved = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, invitation.id))
      .for("update");
    if (!row) return false;
    if (row.maxUses !== null && row.uses >= row.maxUses) return false;
    await tx
      .update(schema.invitations)
      .set({ uses: row.uses + 1 })
      .where(eq(schema.invitations.id, row.id));
    return true;
  });
  if (!reserved) return { ok: false, reason: "invitation_exhausted" };

  const claim = await claimAssignment({
    studyId: invitation.studyId,
    participantId: input.participantId,
    channel: "direct_link",
  });
  if (!claim.ok) {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.invitations)
        .where(eq(schema.invitations.id, invitation.id))
        .for("update");
      if (row)
        await tx
          .update(schema.invitations)
          .set({ uses: Math.max(0, row.uses - 1) })
          .where(eq(schema.invitations.id, row.id));
    });
    return claim;
  }
  await recordDelivery({
    productId: claim.assignment.productId,
    studyId: invitation.studyId,
    participantId: input.participantId,
    channel: "direct_link",
    outcome: "accepted",
  });
  return { ok: true, assignment: claim.assignment };
}

/* ---------------- Deliveries and cooldown ---------------- */

export async function recordDelivery(input: {
  productId: string;
  studyId: string;
  participantId: string;
  channel: Channel;
  outcome: "shown" | "dismissed" | "accepted";
}) {
  const product = await db.query.products.findFirst({
    where: eq(schema.products.id, input.productId),
  });
  if (!product) throw new Error("product not found");
  await db.insert(schema.invitationDeliveries).values({
    id: newId("delivery"),
    tenantId: product.tenantId,
    productId: input.productId,
    studyId: input.studyId,
    participantId: input.participantId,
    channel: input.channel,
    outcome: input.outcome,
  });
}

/* ---------------- Embedded SDK ---------------- */

export type EmbeddedStudyOffer = {
  studyId: string;
  productId: string;
  participantPrompt: string;
  estimatedSeconds: number;
  capture: { screen: string; microphone: string };
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

  const studies = await db.query.studies.findMany({
    where: and(eq(schema.studies.productId, product.id), eq(schema.studies.status, "recruiting")),
  });
  const published = await db.query.studies.findMany({
    where: and(eq(schema.studies.productId, product.id), eq(schema.studies.status, "published")),
  });
  for (const study of [...studies, ...published]) {
    const rev = await db.query.studyRevisions.findFirst({
      where: and(
        eq(schema.studyRevisions.studyId, study.id),
        eq(schema.studyRevisions.revision, study.currentRevision),
      ),
    });
    if (!rev) continue;
    const plan = StudyPlanSchema.parse(rev.plan);
    if (plan.recruitment.source !== "embedded") continue;
    if (input.participantId) {
      const existing = await db.query.assignments.findFirst({
        where: and(
          eq(schema.assignments.studyId, study.id),
          eq(schema.assignments.participantId, input.participantId),
        ),
      });
      if (existing) continue;
    }
    return {
      ok: true,
      study: {
        studyId: study.id,
        productId: product.id,
        participantPrompt: plan.task.participant_prompt,
        estimatedSeconds: plan.task.time_limit_seconds,
        capture: { screen: plan.capture.screen, microphone: plan.capture.microphone },
      },
    };
  }
  return { ok: true, study: null, reason: "no_open_study" };
}
