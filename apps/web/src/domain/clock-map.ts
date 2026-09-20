export type PauseInterval = { start_ms: number; end_ms: number | null };

export type ClockMap = {
  schema_version: "1.0";
  session_started_at: string;
  media: { asset_ref: string; session_offset_ms: number; duration_ms: number | null }[];
  pauses: PauseInterval[];
};

/**
 * The explicit mapping between the monotonic session clock, media archives and pauses
 * (VC-02 "Media and event pipeline"). Transcript offsets are resolved through the same map.
 */
export function buildClockMap(input: {
  sessionStartedAt: Date;
  assets: { asset_ref: string; offset_ms: number; duration_ms: number | null }[];
  pauses: PauseInterval[];
}): ClockMap {
  return {
    schema_version: "1.0",
    session_started_at: input.sessionStartedAt.toISOString(),
    media: input.assets.map((a) => ({
      asset_ref: a.asset_ref,
      session_offset_ms: a.offset_ms,
      duration_ms: a.duration_ms,
    })),
    pauses: input.pauses,
  };
}

/** Task duration excluding documented pauses (VC-05 reporting rule). */
export function activeDurationMs(input: { totalMs: number; pauses: PauseInterval[] }): number {
  const paused = input.pauses.reduce((sum, p) => {
    const end = p.end_ms ?? input.totalMs;
    return sum + Math.max(0, Math.min(end, input.totalMs) - p.start_ms);
  }, 0);
  return Math.max(0, input.totalMs - paused);
}
