import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

describe("rate limiter", () => {
  it("allows up to the limit per key within the window, then refuses until it slides", () => {
    const limit = createRateLimiter({ max: 3, windowMs: 1000 });
    expect([1, 2, 3].map(() => limit.allow("a", 0))).toEqual([true, true, true]);
    expect(limit.allow("a", 500)).toBe(false);
    expect(limit.allow("b", 500)).toBe(true);
    expect(limit.allow("a", 1001)).toBe(true);
  });

  it("forgets idle keys so memory stays bounded", () => {
    const limit = createRateLimiter({ max: 1, windowMs: 100 });
    for (let i = 0; i < 50; i += 1) limit.allow(`k${i}`, 0);
    limit.allow("late", 10_000);
    expect(limit.size()).toBe(1);
  });
});
