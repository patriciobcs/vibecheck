import { describe, expect, it } from "vitest";
import { isInCooldown } from "./cooldown";

const now = new Date("2026-09-19T12:00:00Z");

describe("isInCooldown", () => {
  it("is false when the participant was never invited for this product", () => {
    expect(isInCooldown({ lastInvitedAt: null, now, cooldownDays: 7 })).toBe(false);
  });

  it("is true within the cooldown window", () => {
    const lastInvitedAt = new Date("2026-09-15T12:00:00Z");
    expect(isInCooldown({ lastInvitedAt, now, cooldownDays: 7 })).toBe(true);
  });

  it("is false once the window has elapsed", () => {
    const lastInvitedAt = new Date("2026-09-12T11:59:59Z");
    expect(isInCooldown({ lastInvitedAt, now, cooldownDays: 7 })).toBe(false);
  });

  it("a zero-day cooldown never blocks", () => {
    expect(isInCooldown({ lastInvitedAt: now, now, cooldownDays: 0 })).toBe(false);
  });
});
