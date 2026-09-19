import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/db/client";
import { resetDb } from "@/test/db";
import { seedParticipant, seedStudy } from "@/test/fixtures";
import { claimAssignment } from "./assignments";

beforeEach(resetDb);

describe("claimAssignment", () => {
  it("creates an assignment snapshotting revision, baseline and capture policy", async () => {
    const { studyId, plan } = await seedStudy();
    const { participantId } = await seedParticipant();
    const result = await claimAssignment({ studyId, participantId, channel: "marketplace" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assignment.studyRevision).toBe(1);
    expect(result.assignment.testedCommitSha).toBe(plan.baseline.commit_sha);
    expect(result.assignment.capturePolicy).toEqual(plan.capture);
    expect(result.assignment.state).toBe("assigned");
    expect(result.assignment.fixtureRef).toMatch(/^booking_fixture_v1:/);
  });

  it("is idempotent for the same participant and study", async () => {
    const { studyId } = await seedStudy();
    const { participantId } = await seedParticipant();
    const a = await claimAssignment({ studyId, participantId, channel: "direct_link" });
    const b = await claimAssignment({ studyId, participantId, channel: "direct_link" });
    expect(a.ok && b.ok && a.assignment.id === b.assignment.id).toBe(true);
    expect(await db.$count(schema.assignments)).toBe(1);
  });

  it("never exceeds the study target count under concurrent claims", async () => {
    const { studyId } = await seedStudy({
      recruitment: {
        source: "marketplace",
        target_count: 2,
        cohort: "fresh",
        eligibility_rule_ref: "r",
      },
    });
    const participants = await Promise.all([
      seedParticipant(),
      seedParticipant(),
      seedParticipant(),
      seedParticipant(),
      seedParticipant(),
    ]);
    const results = await Promise.all(
      participants.map((p) =>
        claimAssignment({ studyId, participantId: p.participantId, channel: "marketplace" }),
      ),
    );
    const okCount = results.filter((r) => r.ok).length;
    const full = results.filter((r) => !r.ok && r.reason === "study_full").length;
    expect(okCount).toBe(2);
    expect(full).toBe(3);
    expect(await db.$count(schema.assignments)).toBe(2);
  });

  it("emits exactly one assignment.claimed event", async () => {
    const { studyId } = await seedStudy();
    const { participantId } = await seedParticipant();
    await claimAssignment({ studyId, participantId, channel: "marketplace" });
    await claimAssignment({ studyId, participantId, channel: "marketplace" });
    const events = await db.query.eventOutbox.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("assignment.claimed");
  });

  it("refuses claims when the tenant is paused", async () => {
    const { studyId, tenantId } = await seedStudy();
    await db.update(schema.tenants).set({ paused: true }).where(eq(schema.tenants.id, tenantId));
    const { participantId } = await seedParticipant();
    const result = await claimAssignment({ studyId, participantId, channel: "marketplace" });
    expect(result).toEqual({ ok: false, reason: "paused" });
  });
});

import { eq } from "drizzle-orm";
