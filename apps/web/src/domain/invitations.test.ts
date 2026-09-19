import { SAMPLE_STUDY_PLAN } from "@vibecheck/contracts";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/db/client";
import { resetDb } from "@/test/db";
import { seedParticipant, seedStudy } from "@/test/fixtures";
import { claimAssignment } from "./assignments";
import {
  checkEmbeddedEligibility,
  createDirectLinkInvitation,
  recordDelivery,
  recordEmbeddedDismissal,
  redeemDirectLinkInvitation,
  resolveInvitationToken,
} from "./invitations";

beforeEach(resetDb);

describe("direct link invitations", () => {
  it("stores only a hash of the token and resolves the study from the raw token", async () => {
    const { studyId } = await seedStudy();
    const { token, invitation } = await createDirectLinkInvitation({
      studyId,
      createdByUserId: "u1",
      expiresInDays: 7,
    });
    expect(invitation.tokenHash).not.toContain(token);
    const resolved = await resolveInvitationToken(token);
    expect(resolved.ok && resolved.invitation.studyId === studyId).toBe(true);
  });

  it("rejects an unknown or expired token", async () => {
    const { studyId } = await seedStudy();
    const { token, invitation } = await createDirectLinkInvitation({
      studyId,
      createdByUserId: "u1",
      expiresInDays: 7,
    });
    expect((await resolveInvitationToken("nope")).ok).toBe(false);
    await db
      .update(schema.invitations)
      .set({ expiresAt: new Date(0) })
      .where(eq(schema.invitations.id, invitation.id));
    expect(await resolveInvitationToken(token)).toEqual({ ok: false, reason: "expired" });
  });

  it("redeems into an assignment, increments uses once per participant, and respects max_uses", async () => {
    const { studyId } = await seedStudy();
    const { token } = await createDirectLinkInvitation({
      studyId,
      createdByUserId: "u1",
      expiresInDays: 7,
      maxUses: 1,
    });
    const p1 = await seedParticipant();
    const p2 = await seedParticipant();
    const first = await redeemDirectLinkInvitation({ token, participantId: p1.participantId });
    const again = await redeemDirectLinkInvitation({ token, participantId: p1.participantId });
    const second = await redeemDirectLinkInvitation({ token, participantId: p2.participantId });
    expect(first.ok).toBe(true);
    expect(again.ok && first.ok && again.assignment.id === first.assignment.id).toBe(true);
    expect(second).toEqual({ ok: false, reason: "invitation_exhausted" });
    const inv = await db.query.invitations.findFirst();
    expect(inv?.uses).toBe(1);
  });
});

describe("direct link redemption", () => {
  it("does not consume an invitation use when the claim itself fails", async () => {
    const { studyId, plan } = await seedStudy({
      recruitment: { ...SAMPLE_STUDY_PLAN.recruitment, target_count: 1 },
    });
    expect(plan.recruitment.target_count).toBe(1);
    const taken = await seedParticipant();
    await claimAssignment({ studyId, participantId: taken.participantId, channel: "marketplace" });
    const { token } = await createDirectLinkInvitation({
      studyId,
      createdByUserId: "u1",
      expiresInDays: 7,
      maxUses: 5,
    });
    const late = await seedParticipant();
    expect(await redeemDirectLinkInvitation({ token, participantId: late.participantId })).toEqual({
      ok: false,
      reason: "study_full",
    });
    expect((await db.query.invitations.findFirst())?.uses).toBe(0);
  });
});

describe("embedded dismissal", () => {
  it("records a dismissal only for a study of the product behind the key", async () => {
    const mine = await seedStudy();
    const theirs = await seedStudy();
    const product = await db.query.products.findFirst({
      where: (p, { eq }) => eq(p.id, mine.productId),
    });
    if (!product) throw new Error("product");
    const { participantId } = await seedParticipant();
    const foreign = await recordEmbeddedDismissal({
      publishableKey: product.publishableKey,
      studyId: theirs.studyId,
      participantId,
    });
    expect(foreign).toEqual({ ok: false, reason: "not_found" });
    expect(await db.$count(schema.invitationDeliveries)).toBe(0);
    const own = await recordEmbeddedDismissal({
      publishableKey: product.publishableKey,
      studyId: mine.studyId,
      participantId,
    });
    expect(own).toEqual({ ok: true });
    const delivery = await db.query.invitationDeliveries.findFirst();
    expect(delivery).toMatchObject({ productId: mine.productId, outcome: "dismissed" });
  });
});

describe("embedded eligibility", () => {
  it("offers a recruiting study for a permitted origin", async () => {
    const { productId } = await seedStudy({
      recruitment: {
        source: "embedded",
        target_count: 2,
        cohort: "fresh",
        eligibility_rule_ref: "r",
      },
    });
    const product = await db.query.products.findFirst({ where: eq(schema.products.id, productId) });
    const { participantId } = await seedParticipant();
    const res = await checkEmbeddedEligibility({
      publishableKey: product?.publishableKey ?? "",
      origin: "https://app.example.test",
      participantId,
    });
    expect(res.ok && res.study?.studyId !== undefined).toBe(true);
  });

  it("rejects a non-permitted origin", async () => {
    const { productId } = await seedStudy();
    const product = await db.query.products.findFirst({ where: eq(schema.products.id, productId) });
    const { participantId } = await seedParticipant();
    const res = await checkEmbeddedEligibility({
      publishableKey: product?.publishableKey ?? "",
      origin: "https://evil.example",
      participantId,
    });
    expect(res).toEqual({ ok: false, reason: "origin_not_permitted" });
  });

  it("applies the per-product cooldown after an invitation was shown", async () => {
    const { productId, studyId } = await seedStudy({
      recruitment: {
        source: "embedded",
        target_count: 2,
        cohort: "fresh",
        eligibility_rule_ref: "r",
      },
    });
    const product = await db.query.products.findFirst({ where: eq(schema.products.id, productId) });
    const { participantId } = await seedParticipant();
    await recordDelivery({
      productId,
      studyId,
      participantId,
      channel: "embedded",
      outcome: "dismissed",
    });
    const res = await checkEmbeddedEligibility({
      publishableKey: product?.publishableKey ?? "",
      origin: "https://app.example.test",
      participantId,
    });
    expect(res.ok && res.study).toBeNull();
    expect(res.ok && res.reason).toBe("cooldown");
  });
});
