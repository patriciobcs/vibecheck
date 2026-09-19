"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { sessionEvidence } from "@/domain/owner";

type Evidence = NonNullable<Awaited<ReturnType<typeof sessionEvidence>>>;
const EMPTY_VTT = `data:text/vtt;charset=utf-8,${encodeURIComponent("WEBVTT\n")}`;

type MediaLink = {
  asset_id: string;
  offset_ms: number;
  duration_ms: number | null;
  url: string;
  expires_in_seconds: number;
};

function fmt(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * One session clock drives the player, transcript and event list. Media URLs are signed and
 * short-lived; they are fetched on demand and never rendered into permanent markup.
 */
export function EvidencePlayer({ evidence }: { evidence: Evidence }) {
  const [links, setLinks] = useState<MediaLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [clockMs, setClockMs] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    fetch(`/api/owner/sessions/${evidence.session.id}/media`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`media links ${r.status}`);
        const body = (await r.json()) as { media: MediaLink[] };
        setLinks(body.media);
      })
      .catch((e: Error) => setError(e.message));
  }, [evidence.session.id]);

  const active = links?.[activeIdx] ?? null;

  function seekTo(sessionMs: number) {
    if (!links) return;
    const idx = links.findIndex(
      (l, i) =>
        sessionMs >= l.offset_ms &&
        (i === links.length - 1 ||
          sessionMs < (links[i + 1]?.offset_ms ?? Number.POSITIVE_INFINITY)),
    );
    if (idx >= 0 && idx !== activeIdx) setActiveIdx(idx);
    const link = links[idx >= 0 ? idx : activeIdx];
    if (videoRef.current && link) {
      videoRef.current.currentTime = Math.max(0, (sessionMs - link.offset_ms) / 1000);
      void videoRef.current.play().catch(() => {});
    }
    setClockMs(sessionMs);
  }

  // Captions come from the transcript itself, re-based onto this archive's own timeline.
  const captionsUrl = useMemo(() => {
    if (!active) return null;
    const cues = evidence.transcript
      .filter((t) => t.assetId === active.asset_id)
      .map(
        (t, i) =>
          `${i + 1}\n${vtt(t.startMs - active.offset_ms)} --> ${vtt(t.endMs - active.offset_ms)}\n${t.text}\n`,
      );
    if (cues.length === 0) return null;
    return `data:text/vtt;charset=utf-8,${encodeURIComponent(`WEBVTT\n\n${cues.join("\n")}`)}`;
  }, [active, evidence.transcript]);

  const activeSegment = useMemo(
    () => evidence.transcript.find((t) => clockMs >= t.startMs && clockMs <= t.endMs)?.id ?? null,
    [clockMs, evidence.transcript],
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div>
        <div className="surface overflow-hidden">
          {active ? (
            <video
              ref={videoRef}
              key={active.asset_id}
              src={active.url}
              controls
              playsInline
              className="aspect-video w-full bg-black"
              onTimeUpdate={(e) =>
                setClockMs(active.offset_ms + e.currentTarget.currentTime * 1000)
              }
            >
              <track
                kind="captions"
                src={captionsUrl ?? EMPTY_VTT}
                srcLang="en"
                label="Transcript"
                default
              />
            </video>
          ) : (
            <div className="flex aspect-video items-center justify-center bg-secondary text-sm text-muted-foreground">
              {error
                ? `Media unavailable: ${error}`
                : links
                  ? "No verified media for this session."
                  : "Loading media…"}
            </div>
          )}
          <div className="flex items-center justify-between px-4 py-2 text-xs text-muted-foreground">
            <span className="tabular-nums">Session clock {fmt(clockMs)}</span>
            {links && links.length > 1 ? (
              <span>
                Part {activeIdx + 1} of {links.length}
                {evidence.session.pauses.length > 0
                  ? ` · ${evidence.session.pauses.length} pause${evidence.session.pauses.length === 1 ? "" : "s"}`
                  : ""}
              </span>
            ) : null}
          </div>
        </div>

        <section className="surface mt-6 max-h-[420px] overflow-y-auto p-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Events ({evidence.events.length})
          </p>
          {evidence.events.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No instrumented events. Either the target was not instrumented or the SDK handshake
              did not complete.
            </p>
          ) : null}
          <ol className="space-y-1 text-xs">
            {evidence.events.map((e) => (
              <li key={e.sequence}>
                <button
                  type="button"
                  onClick={() => seekTo(e.tMs)}
                  className="flex w-full gap-3 rounded-md px-2 py-1 text-left hover:bg-secondary"
                >
                  <span className="w-12 shrink-0 tabular-nums text-muted-foreground">
                    {fmt(e.tMs)}
                  </span>
                  <span className="w-28 shrink-0 font-medium">{e.type}</span>
                  <span className="truncate font-mono text-muted-foreground">
                    {summarize(e.payload)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <section className="surface max-h-[760px] overflow-y-auto p-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Transcript · {evidence.session.transcriptStatus}
        </p>
        {evidence.transcript.length === 0 ? (
          <p className="text-sm text-muted-foreground">No transcript yet.</p>
        ) : null}
        <ol className="space-y-2">
          {evidence.transcript.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => seekTo(t.startMs)}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-secondary ${activeSegment === t.id ? "bg-brand/10" : ""}`}
              >
                <span className="mr-2 tabular-nums text-xs text-muted-foreground">
                  {fmt(t.startMs)}
                </span>
                {t.text}
              </button>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function vtt(ms: number) {
  const clamped = Math.max(0, ms);
  const h = Math.floor(clamped / 3_600_000);
  const m = Math.floor((clamped % 3_600_000) / 60_000);
  const s = Math.floor((clamped % 60_000) / 1000);
  const frac = clamped % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(frac).padStart(3, "0")}`;
}

function summarize(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof p.safe_target_ref === "string") parts.push(p.safe_target_ref);
  if (typeof p.path === "string") parts.push(p.path);
  if (typeof p.key === "string") parts.push(p.key);
  if (typeof p.label === "string") parts.push(p.label);
  if (typeof p.count === "number") parts.push(`×${p.count}`);
  return parts.join(" ");
}
