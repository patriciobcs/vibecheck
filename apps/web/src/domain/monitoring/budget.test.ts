import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "@/test/db";
import { reconcileUsage, reserveEvaluation } from "./budget";

const policy = {
  max_evaluations_per_product_day: 2,
  max_evaluations_per_session_hour: 1,
  max_input_tokens: 6000,
  max_output_tokens_budget: 1000,
  daily_spend_cap_usd: 5,
};

beforeEach(resetDb);

describe("evaluation budget", () => {
  it("reserves atomically and refuses once the product day cap is hit", async () => {
    const results = await Promise.all(
      [1, 2, 3, 4].map((i) =>
        reserveEvaluation({
          productId: "p",
          observationSessionId: `s${i}`,
          policy,
          priceMicrosPer1k: null,
          estimatedInputTokens: 500,
        }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.filter((r) => !r.ok).map((r) => (r.ok ? "" : r.reason))).toEqual([
      "product_day_cap",
      "product_day_cap",
    ]);
  });

  it("enforces the per-session hourly cap", async () => {
    const a = await reserveEvaluation({
      productId: "p",
      observationSessionId: "s1",
      policy,
      priceMicrosPer1k: null,
      estimatedInputTokens: 500,
    });
    const b = await reserveEvaluation({
      productId: "p",
      observationSessionId: "s1",
      policy,
      priceMicrosPer1k: null,
      estimatedInputTokens: 500,
    });
    expect(a.ok).toBe(true);
    expect(b).toEqual({ ok: false, reason: "session_hour_cap" });
  });

  it("refuses when the estimated input exceeds the token limit", async () => {
    expect(
      await reserveEvaluation({
        productId: "p",
        observationSessionId: "s1",
        policy,
        priceMicrosPer1k: null,
        estimatedInputTokens: 9000,
      }),
    ).toEqual({ ok: false, reason: "input_tokens_cap" });
  });

  it("spend cap is enforced only with a configured price and reconciles with returned usage", async () => {
    const unpriced = await reserveEvaluation({
      productId: "p",
      observationSessionId: "s1",
      policy: { ...policy, daily_spend_cap_usd: 0.000001 },
      priceMicrosPer1k: null,
      estimatedInputTokens: 500,
    });
    expect(unpriced.ok && unpriced.spendEnforced).toBe(false);
    const priced = await reserveEvaluation({
      productId: "p2",
      observationSessionId: "s2",
      policy: { ...policy, daily_spend_cap_usd: 0.001 },
      priceMicrosPer1k: { input: 3000, output: 15000 },
      estimatedInputTokens: 500,
    });
    expect(priced).toEqual({ ok: false, reason: "spend_cap" });
    const ok = await reserveEvaluation({
      productId: "p3",
      observationSessionId: "s3",
      policy,
      priceMicrosPer1k: { input: 3000, output: 15000 },
      estimatedInputTokens: 500,
    });
    expect(ok.ok && ok.spendEnforced).toBe(true);
    const ledger = await reconcileUsage({
      productId: "p3",
      inputTokens: 800,
      outputTokens: 40,
      priceMicrosPer1k: { input: 3000, output: 15000 },
      reservedMicros: ok.ok ? ok.reservedMicros : 0,
    });
    expect(ledger.inputTokens).toBe(800);
    expect(ledger.estimatedCostMicros).toBe(Math.round((800 * 3000) / 1000 + (40 * 15000) / 1000));
  });
});
