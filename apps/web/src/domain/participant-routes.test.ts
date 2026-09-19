import { beforeEach, describe, expect, it } from "vitest";
import { POST as embedClaim } from "@/app/api/embed/claim/route";
import { POST as embedDevice } from "@/app/api/embed/device/route";
import { POST as redeemInvitation } from "@/app/api/invitations/redeem/route";
import { POST as marketplaceClaim } from "@/app/api/marketplace/claim/route";
import { POST as observeEvents } from "@/app/api/observe/events/route";
import { db, schema } from "@/db/client";
import { issueAssignmentToken } from "@/lib/assignment-token";
import { issueObservationToken } from "@/lib/session-token";
import { resetDb } from "@/test/db";
import { seedParticipant, seedStudy } from "@/test/fixtures";
import { claimAssignment } from "./assignments";
import { createDirectLinkInvitation } from "./invitations";
import { openObservationSession } from "./monitoring/ingest";
import { setMonitoringPolicy } from "./monitoring/policy";

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(resetDb);

describe("assignment token scope", () => {
  async function tokenForOneAssignment() {
    const first = await seedStudy();
    const { participantId } = await seedParticipant();
    const claim = await claimAssignment({
      studyId: first.studyId,
      participantId,
      channel: "marketplace",
    });
    if (!claim.ok) throw new Error("claim");
    const token = await issueAssignmentToken({ assignmentId: claim.assignment.id, participantId });
    const second = await seedStudy();
    return { token, second, participantId };
  }

  it("cannot claim another study through the marketplace", async () => {
    const { token, second } = await tokenForOneAssignment();
    const res = await marketplaceClaim(
      post(
        "/api/marketplace/claim",
        { study_id: second.studyId },
        { authorization: `Bearer ${token}` },
      ),
      {} as never,
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("token_scope_mismatch");
    expect(await db.$count(schema.assignments)).toBe(1);
  });

  it("cannot claim another study through the embedded channel", async () => {
    const { token, second } = await tokenForOneAssignment();
    const product = await db.query.products.findFirst({
      where: (p, { eq }) => eq(p.id, second.productId),
    });
    const res = await embedClaim(
      post(
        "/api/embed/claim",
        { study_id: second.studyId, publishable_key: product?.publishableKey },
        { authorization: `Bearer ${token}` },
      ),
      {} as never,
    );
    expect(res.status).toBe(403);
    expect(await db.$count(schema.assignments)).toBe(1);
  });

  it("cannot redeem a direct link for another study", async () => {
    const { token, second } = await tokenForOneAssignment();
    const invitation = await createDirectLinkInvitation({
      studyId: second.studyId,
      createdByUserId: "u1",
      expiresInDays: 7,
    });
    const res = await redeemInvitation(
      post(
        "/api/invitations/redeem",
        { token: invitation.token },
        { authorization: `Bearer ${token}` },
      ),
      {} as never,
    );
    expect(res.status).toBe(403);
    expect(await db.$count(schema.assignments)).toBe(1);
  });
});

describe("device participants", () => {
  it("requires a known publishable key", async () => {
    await seedStudy();
    const unknown = await embedDevice(
      post("/api/embed/device", { publishable_key: "pk_nope" }),
      {} as never,
    );
    expect(unknown.status).toBe(404);
    expect(await db.$count(schema.participants)).toBe(0);
    const product = await db.query.products.findFirst();
    const ok = await embedDevice(
      post("/api/embed/device", { publishable_key: product?.publishableKey }),
      {} as never,
    );
    expect(ok.status).toBe(200);
    expect(await db.$count(schema.participants)).toBe(1);
  });

  it("rate limits device creation per client address", async () => {
    await seedStudy();
    const product = await db.query.products.findFirst();
    const body = { publishable_key: product?.publishableKey };
    const ip = { "x-forwarded-for": "203.0.113.9" };
    let last = 0;
    for (let i = 0; i < 25; i += 1) {
      last = (await embedDevice(post("/api/embed/device", body, ip), {} as never)).status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
    expect(await db.$count(schema.participants)).toBeLessThan(25);
  });
});

describe("observation events endpoint", () => {
  it("answers malformed JSON with 400 instead of failing", async () => {
    const { productId } = await seedStudy();
    await setMonitoringPolicy(productId, { enabled: true }, null);
    const product = await db.query.products.findFirst();
    if (!product) throw new Error("product");
    const opened = await openObservationSession({
      publishableKey: product.publishableKey,
      origin: "https://app.example.test",
      buildRef: "b",
      collectionPermission: "granted",
    });
    if (!opened.ok) throw new Error("open");
    const token = await issueObservationToken({
      observationSessionId: opened.sessionId,
      productId,
    });
    const res = await observeEvents(
      post("/api/observe/events", "{not json", {
        authorization: `Bearer ${token}`,
        origin: "https://app.example.test",
        "x-vibecheck-key": product.publishableKey,
      }),
      {} as never,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_json");
  });
});
