import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/db/client";
import { resetDb } from "@/test/db";
import { seedParticipant, seedStudy } from "@/test/fixtures";
import {
  checkEmbeddedEligibility,
  createDirectLinkInvitation,
  recordDelivery,
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
