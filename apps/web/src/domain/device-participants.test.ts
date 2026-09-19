import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/db/client";
import { resetDb } from "@/test/db";
import { seedStudy } from "@/test/fixtures";
import { claimAssignment } from "./assignments";
import { deviceParticipant, issueDeviceToken } from "./device-participants";

beforeEach(resetDb);

describe("device participants", () => {
  it("creates one participant per device token and reuses it", async () => {
    const { token } = await issueDeviceToken();
    const a = await deviceParticipant(token);
    const b = await deviceParticipant(token);
    expect(a?.id).toBe(b?.id);
    expect(a?.userId).toBeNull();
    expect(await db.$count(schema.participants)).toBe(1);
  });

  it("rejects an unknown token", async () => {
    expect(await deviceParticipant("nope")).toBeNull();
  });

  it("a device participant can claim an embedded study", async () => {
    const { studyId } = await seedStudy({
      recruitment: {
        source: "embedded",
        target_count: 1,
        cohort: "fresh",
        eligibility_rule_ref: "r",
      },
    });
    const { token } = await issueDeviceToken();
    const p = await deviceParticipant(token);
    if (!p) throw new Error("no participant");
    const claim = await claimAssignment({ studyId, participantId: p.id, channel: "embedded" });
    expect(claim.ok).toBe(true);
  });
});
