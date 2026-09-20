import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "@/test/db";
import { seedStudy } from "@/test/fixtures";
import { currentMonitoringPolicy, setMonitoringPolicy } from "./policy";

beforeEach(resetDb);

describe("monitoring policy", () => {
  it("defaults to a disabled policy and stores immutable revisions", async () => {
    const { productId } = await seedStudy();
    const initial = await currentMonitoringPolicy(productId);
    expect(initial.policy.enabled).toBe(false);
    expect(initial.revision).toBe(0);
    const r1 = await setMonitoringPolicy(productId, { enabled: true, window_ms: 60_000 }, "user_1");
    const r2 = await setMonitoringPolicy(productId, { cooldown_ms: 10_000 }, "user_1");
    expect(r1.revision).toBe(1);
    expect(r2.revision).toBe(2);
    expect(r2.policy).toMatchObject({ enabled: true, window_ms: 60_000, cooldown_ms: 10_000 });
    expect((await currentMonitoringPolicy(productId)).policy.policy_id).toBe(
      `monitoring_policy:${productId}:2`,
    );
  });
});
