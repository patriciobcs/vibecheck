/**
 * Small in-memory sliding-window limiter for abuse-prone public endpoints. Per process only: it
 * bounds accidental or casual spam, not a distributed attack (put a CDN/WAF rule in front for that).
 */
export function createRateLimiter(opts: { max: number; windowMs: number }) {
  const hits = new Map<string, number[]>();
  let lastSweep = 0;
  function sweep(now: number) {
    if (now - lastSweep < opts.windowMs) return;
    lastSweep = now;
    for (const [key, times] of hits) {
      const live = times.filter((t) => now - t < opts.windowMs);
      if (live.length === 0) hits.delete(key);
      else hits.set(key, live);
    }
  }
  return {
    /** True when the key may proceed; records the hit when allowed. */
    allow(key: string, now = Date.now()): boolean {
      sweep(now);
      const live = (hits.get(key) ?? []).filter((t) => now - t < opts.windowMs);
      if (live.length >= opts.max) {
        hits.set(key, live);
        return false;
      }
      live.push(now);
      hits.set(key, live);
      return true;
    },
    size: () => hits.size,
  };
}

/** Best-effort client address behind a proxy; falls back to a shared bucket. */
export function clientAddress(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || "unknown";
}
