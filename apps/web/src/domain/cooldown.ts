const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Invitation cooldown (VC-02): default one invitation per participant/product per seven days.
 * A zero-day cooldown disables the rule.
 */
export function isInCooldown(input: {
  lastInvitedAt: Date | null;
  now: Date;
  cooldownDays: number;
}): boolean {
  if (!input.lastInvitedAt || input.cooldownDays <= 0) return false;
  return input.now.getTime() - input.lastInvitedAt.getTime() < input.cooldownDays * DAY_MS;
}
