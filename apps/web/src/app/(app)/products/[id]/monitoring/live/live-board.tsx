"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LiveBoardData, LiveSessionRef } from "@/domain/monitoring/live";
import { CandidateActions } from "../candidate-actions";

type Board = LiveBoardData;
type Session = Board["sessions"][number];
type ObservationDetail = Extract<NonNullable<Board["selected"]>, { kind: "observation" }>;
type StudyDetail = Extract<NonNullable<Board["selected"]>, { kind: "study" }>;
type Evaluation = ObservationDetail["evaluations"][number];
type Answer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; confidence: number; probabilities?: Record<string, number> }
  | { type: "score"; score: number; confidence: number };

const POLL_MS = 1000;
const TAB_LIMIT = 6;

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const ago = (iso: string, now: number) => {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};
const pct = (v: number) => `${Math.round(v * 100)}%`;
const words = (s: string) => s.replace(/_/g, " ");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Live analysis for a video demo's second window. Polls persisted state every second; every row
 * is a stored event, window, evaluation, asset or transcript segment. No simulated progress.
 */
export function LiveBoard({
  productId,
  productName,
  productUrl,
  initial = null,
}: {
  productId: string;
  productName: string;
  productUrl: string;
  /** `?session=study:<id>` pins one session from the start (demo links, screenshots). */
  initial?: LiveSessionRef | null;
}) {
  const [data, setData] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pinned, setPinned] = useState<LiveSessionRef | null>(initial);
  const [now, setNow] = useState(() => Date.now());
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const inFlight = useRef(false);
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;
  const sessionsRef = useRef<Session[]>([]);

  useEffect(() => {
    let stopped = false;
    const load = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const target = pinnedRef.current ?? newest(sessionsRef.current);
        const qs = target ? `?kind=${target.kind}&session=${encodeURIComponent(target.id)}` : "";
        const res = await fetch(`/api/owner/products/${productId}/live${qs}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`live feed ${res.status}`);
        const next = (await res.json()) as Board;
        if (stopped) return;
        sessionsRef.current = next.sessions;
        setData(next);
        setError(null);
        setUpdatedAt(Date.now());
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message : "feed unavailable");
      } finally {
        inFlight.current = false;
      }
    };
    void load();
    const poll = setInterval(() => void load(), POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), 500);
    return () => {
      stopped = true;
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [productId]);

  const sessions = data?.sessions ?? [];
  const effective = pinned ?? data?.selectedRef ?? newest(sessions);
  const following = pinned === null;

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {productName}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Live analysis</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Semantic logs, screening decisions and Jev answers as they are stored. Signals, not
            findings.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {data ? (
            <>
              <Pill
                ok={data.product.policy.enabled}
                label={data.product.policy.enabled ? "Collection on" : "Collection off"}
              />
              <Pill
                ok={data.product.jev}
                label={data.product.jev ? "Jev configured" : "Jev not configured"}
              />
              <Pill
                ok={data.product.activeDetectors > 0}
                label={`${data.product.activeDetectors} active detector${data.product.activeDetectors === 1 ? "" : "s"}`}
              />
            </>
          ) : null}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-muted-foreground">
            <span
              className={`size-1.5 rounded-full ${error ? "bg-destructive" : "live-pulse bg-success"}`}
            />
            {error
              ? error
              : updatedAt
                ? `updated ${ago(new Date(updatedAt).toISOString(), now)}`
                : "connecting"}
          </span>
        </div>
      </header>

      {!data ? (
        <div className="surface p-10 text-center text-sm text-muted-foreground">Connecting…</div>
      ) : sessions.length === 0 ? (
        <Waiting data={data} productUrl={productUrl} />
      ) : (
        <>
          <SessionPicker
            sessions={sessions}
            selected={effective}
            following={following}
            now={now}
            onPick={(ref) => setPinned(ref)}
            onFollow={() => setPinned(null)}
          />
          {data.selected?.kind === "observation" ? (
            <ObservationBoard detail={data.selected} board={data} now={now} />
          ) : data.selected?.kind === "study" ? (
            <StudyBoard detail={data.selected} now={now} />
          ) : (
            <div className="surface mt-4 p-8 text-center text-sm text-muted-foreground">
              Loading session…
            </div>
          )}
        </>
      )}
    </div>
  );
}

function newest(sessions: Session[]): LiveSessionRef | null {
  const s =
    sessions.find((x) => x.state === "recording") ??
    sessions.find((x) => x.live && x.events > 0) ??
    sessions.find((x) => x.events > 0) ??
    sessions[0];
  return s ? { kind: s.kind, id: s.id } : null;
}

function Waiting({ data, productUrl }: { data: Board; productUrl: string }) {
  const p = data.product.policy;
  return (
    <div className="surface flex flex-col items-center px-8 py-16 text-center">
      <span className="live-pulse mb-5 size-3 rounded-full bg-brand" />
      <h2 className="text-xl font-semibold tracking-tight">Waiting for the first session</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Open{" "}
        <a
          className="text-brand underline-offset-4 hover:underline"
          href={productUrl}
          target="_blank"
          rel="noreferrer"
        >
          {productUrl}
        </a>{" "}
        with the SDK installed. A visitor who grants collection, or a participant who starts a study
        task, appears here within {Math.max(1, Math.round(p.batchDelayMs / 1000))} s.
      </p>
      {!p.enabled ? (
        <p className="mt-4 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Passive collection is off for this product. Study sessions still show here.
        </p>
      ) : null}
      {!data.product.jev ? (
        <p className="mt-2 rounded-xl bg-secondary px-3 py-2 text-xs text-muted-foreground">
          Jev is not configured: windows will queue and stay unevaluated.
        </p>
      ) : null}
    </div>
  );
}

function SessionPicker({
  sessions,
  selected,
  following,
  now,
  onPick,
  onFollow,
}: {
  sessions: Session[];
  selected: LiveSessionRef | null;
  following: boolean;
  now: number;
  onPick: (ref: LiveSessionRef) => void;
  onFollow: () => void;
}) {
  const isSel = (s: Session) => selected?.kind === s.kind && selected.id === s.id;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {sessions.length <= TAB_LIMIT ? (
        <div className="flex flex-wrap gap-1 rounded-full bg-secondary/70 p-1">
          {sessions.map((s) => (
            <button
              key={`${s.kind}:${s.id}`}
              type="button"
              onClick={() => onPick({ kind: s.kind, id: s.id })}
              className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs transition-colors ${
                isSel(s)
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${s.live ? "live-pulse bg-success" : "bg-border"}`}
              />
              <span className="font-medium">{s.label}</span>
              <span className="capitalize opacity-70">{words(s.state)}</span>
              <span className="tabular-nums opacity-60">{s.events} ev</span>
            </button>
          ))}
        </div>
      ) : (
        <select
          className="h-9 rounded-full border border-border bg-card px-3 text-sm"
          value={selected ? `${selected.kind}:${selected.id}` : ""}
          onChange={(e) => {
            const [kind, id] = e.target.value.split(":") as ["observation" | "study", string];
            if (kind && id) onPick({ kind, id });
          }}
        >
          {sessions.map((s) => (
            <option key={`${s.kind}:${s.id}`} value={`${s.kind}:${s.id}`}>
              {s.live ? "● " : ""}
              {s.label} · {words(s.state)} · {s.events} events · {ago(s.lastActivityAt, now)}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        onClick={onFollow}
        className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
          following
            ? "bg-foreground text-background"
            : "bg-secondary text-muted-foreground hover:text-foreground"
        }`}
      >
        {following ? "Following newest" : "Follow newest"}
      </button>
      <span className="text-xs text-muted-foreground">
        {sessions.length} session{sessions.length === 1 ? "" : "s"}
      </span>
    </div>
  );
}

/* ---------------- Passive observation session ---------------- */

function ObservationBoard({
  detail,
  board,
  now,
}: {
  detail: ObservationDetail;
  board: Board;
  now: number;
}) {
  const events = detail.events;
  const lastAt = detail.session.lastEventAt ? new Date(detail.session.lastEventAt).getTime() : null;
  const latestWindowAt = detail.evaluations[0]
    ? new Date(detail.evaluations[0].requestedAt).getTime()
    : 0;
  const scanDue =
    lastAt && lastAt > latestWindowAt
      ? Math.max(0, lastAt + board.product.policy.batchDelayMs - now)
      : null;
  const journeys = [...new Set(events.map((e) => e.journeyId))];
  return (
    <div className="grid gap-4 lg:grid-cols-4">
      <Column
        title="Signals"
        hint={`${events.length} semantic events · ${journeys.length} journey${journeys.length === 1 ? "" : "s"}`}
      >
        <Sparkline times={events.map((e) => new Date(e.receivedAt).getTime())} now={now} />
        <ul className="mt-3 space-y-1.5">
          {[...events]
            .reverse()
            .slice(0, 40)
            .map((e) => (
              <li key={e.id} className="live-in flex items-start gap-2 text-xs">
                <span className="w-10 shrink-0 pt-0.5 tabular-nums text-muted-foreground">
                  {mmss(e.tMs)}
                </span>
                <div className="min-w-0 flex-1">
                  <span
                    className={`whitespace-nowrap rounded-md px-1.5 py-0.5 font-medium ${eventTone(e.type)}`}
                  >
                    {words(e.type)}
                  </span>
                  <span className="ml-1.5 text-muted-foreground">{e.journeyId}</span>
                  <Refs payload={e.payload} />
                </div>
              </li>
            ))}
          {events.length === 0 ? <Empty>No events yet.</Empty> : null}
        </ul>
      </Column>

      <Column
        title="Screening"
        hint={`batch ${Math.round(board.product.policy.batchDelayMs / 1000)}s · cooldown ${Math.round(board.product.policy.cooldownMs / 1000)}s`}
      >
        {scanDue !== null ? (
          <p className="mb-3 flex items-center gap-2 rounded-xl bg-secondary/70 px-3 py-2 text-xs">
            <span className="live-pulse size-1.5 rounded-full bg-brand" />
            Scan due in {Math.ceil(scanDue / 1000)}s
          </p>
        ) : null}
        <ul className="space-y-2">
          {detail.evaluations.map((ev) => (
            <li
              key={`w-${ev.id}`}
              className="live-in rounded-xl border border-border/70 p-3 text-xs"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium capitalize">{words(ev.triggerReason)}</span>
                <span className="text-muted-foreground">{ev.window?.events ?? 0} events</span>
              </div>
              {ev.window ? (
                <>
                  <p className="mt-1 text-muted-foreground">
                    {mmss(ev.window.startMs)}–{mmss(ev.window.endMs)} · goal {ev.window.goalSource}
                    {ev.window.gaps.length
                      ? ` · ${ev.window.gaps.length} gap${ev.window.gaps.length === 1 ? "" : "s"}`
                      : ""}
                  </p>
                  <Coverage coverage={ev.window.coverage} />
                </>
              ) : null}
              <p className="mt-1 text-muted-foreground">detector {ev.detectorRef}</p>
            </li>
          ))}
          {detail.evaluations.length === 0 ? (
            <Empty>
              {events.length === 0
                ? "Waiting for a journey."
                : "No trigger yet: a help request, repeated failure, stall or loop starts a window."}
            </Empty>
          ) : null}
        </ul>
      </Column>

      <Column title="Jev" hint={board.product.jev ? "typesafe.ai systemone" : "not configured"}>
        <ul className="space-y-3">
          {detail.evaluations.map((ev) => (
            <EvaluationCard key={ev.id} ev={ev} board={board} now={now} />
          ))}
          {detail.evaluations.length === 0 ? <Empty>Nothing evaluated yet.</Empty> : null}
        </ul>
      </Column>

      <Column
        title="Candidates"
        hint={`gate ${pct(board.product.policy.frictionThreshold)} / ${pct(board.product.policy.researchThreshold)}`}
      >
        <ul className="space-y-3">
          {detail.candidates.map((c) => (
            <li key={c.id} className="live-in rounded-xl border border-border/70 p-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium capitalize">{words(c.category)}</span>
                <StatePill state={c.state} />
              </div>
              <p className="mt-1 text-muted-foreground">
                {c.journeyId} · {c.targetRef}
              </p>
              <p className="mt-2 leading-relaxed">{c.suspectedProblem}</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Bar
                  label="friction"
                  value={(c.latestFrictionPermille ?? 0) / 1000}
                  threshold={board.product.policy.frictionThreshold}
                />
                <Bar
                  label="research"
                  value={(c.latestResearchPermille ?? 0) / 1000}
                  threshold={board.product.policy.researchThreshold}
                />
              </div>
              <p className="mt-2 text-muted-foreground">
                {c.distinctObservationSessions} session
                {c.distinctObservationSessions === 1 ? "" : "s"} · {c.distinctJourneyInstances}{" "}
                journey{c.distinctJourneyInstances === 1 ? "" : "s"} · {ago(c.updatedAt, now)}
              </p>
              {c.evidenceLimitations.length ? (
                <p className="mt-1 text-muted-foreground">
                  Limits: {c.evidenceLimitations.join("; ")}
                </p>
              ) : null}
              <div className="mt-2 flex gap-2">
                <CandidateActions
                  candidateId={c.id}
                  state={c.state}
                  devinReady={board.product.devin}
                />
              </div>
            </li>
          ))}
          {detail.candidates.length === 0 ? (
            <Empty>
              {detail.evaluations.some((e) => e.status === "completed")
                ? "Below the gate: no candidate from this session."
                : "A candidate appears when an evaluation passes the gate."}
            </Empty>
          ) : null}
        </ul>
      </Column>
    </div>
  );
}

function EvaluationCard({ ev, board, now }: { ev: Evaluation; board: Board; now: number }) {
  const answers = (ev.answers ?? {}) as Record<string, Answer>;
  const running = ev.status === "queued" || ev.status === "running";
  const elapsed = running ? now - new Date(ev.requestedAt).getTime() : ev.latencyMs;
  return (
    <li className="live-in rounded-xl border border-border/70 p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-medium">
          {running ? <span className="live-pulse size-1.5 rounded-full bg-brand" /> : null}
          <span className="capitalize">{words(ev.status)}</span>
        </span>
        <span className="text-muted-foreground">{ev.returnedModel ?? ev.requestedModel}</span>
      </div>
      <p className="mt-1 text-muted-foreground">
        {words(ev.triggerReason)} · {elapsed !== null ? `${(elapsed / 1000).toFixed(1)}s` : "—"}
        {ev.inputTokens !== null
          ? ` · ${ev.inputTokens} in / ${ev.outputTokens ?? 0} out tokens`
          : ""}
        {ev.estimatedCostMicros !== null
          ? ` · $${(ev.estimatedCostMicros / 1_000_000).toFixed(4)}`
          : ""}
      </p>
      {ev.statusReason && !running ? (
        <p className="mt-1 text-destructive">{ev.statusReason}</p>
      ) : null}
      {ev.status === "completed" ? (
        <div className="mt-3 space-y-2">
          <Bar
            label="Friction observed"
            value={noul(answers.ux_friction_observed)}
            threshold={board.product.policy.frictionThreshold}
          />
          <Bar
            label="Research warranted"
            value={noul(answers.targeted_research_warranted)}
            threshold={board.product.policy.researchThreshold}
          />
          <Choice label="Evidence" answer={answers.evidence_sufficiency} />
          <Choice label="Category" answer={answers.problem_category} />
          {Object.entries(answers)
            .filter(
              ([k]) =>
                ![
                  "ux_friction_observed",
                  "targeted_research_warranted",
                  "evidence_sufficiency",
                  "problem_category",
                ].includes(k),
            )
            .map(([k, a]) =>
              a.type === "noul" ? (
                <Bar key={k} label={words(k)} value={a.noul} />
              ) : a.type === "choice" ? (
                <Choice key={k} label={words(k)} answer={a} />
              ) : null,
            )}
        </div>
      ) : null}
      {ev.state ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            State sent to Jev
          </summary>
          <pre className="mt-1 max-h-56 overflow-auto rounded-lg bg-secondary/70 p-2 font-mono text-[10px] leading-relaxed">
            {JSON.stringify(ev.state, null, 1)}
          </pre>
        </details>
      ) : null}
    </li>
  );
}

const noul = (a: Answer | undefined) => (a?.type === "noul" ? a.noul : 0);

/* ---------------- Study (opted-in task) session ---------------- */

function StudyBoard({ detail, now }: { detail: StudyDetail; now: number }) {
  const s = detail.session;
  const semantic = detail.events.filter((e) => e.type === "semantic");
  const interactions = detail.events.filter((e) => e.type !== "semantic");
  const counts: Record<string, number> = {};
  for (const e of interactions) counts[e.type] = (counts[e.type] ?? 0) + 1;
  const started = s.startedAt ? new Date(s.startedAt).getTime() : null;
  const ended = s.endedAt ? new Date(s.endedAt).getTime() : null;
  const elapsed = started ? (ended ?? now) - started : 0;
  return (
    <div className="grid gap-4 lg:grid-cols-4">
      <Column title="Task" hint={`${words(s.channel ?? "")} · ${words(s.state)}`}>
        {s.task ? (
          <>
            <p className="text-[13px] leading-relaxed">{s.task.prompt}</p>
            <p className="mt-2 text-xs text-muted-foreground">Question: {s.task.question}</p>
          </>
        ) : null}
        <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <Stat label="Elapsed" value={mmss(elapsed)} />
          <Stat label="Pauses" value={String(s.pauses.length)} />
          <Stat label="Microphone" value={cap(s.capture?.microphone ?? "—")} />
          <Stat
            label="Screen"
            value={
              s.capture?.screen === "off" ? "Off, logs instead" : cap(s.capture?.screen ?? "—")
            }
          />
        </dl>
        {s.participantReportedOutcome !== "unknown" ? (
          <p className="mt-3 text-xs">
            Reported:{" "}
            <span className="font-medium capitalize">{words(s.participantReportedOutcome)}</span>
          </p>
        ) : null}
      </Column>

      <Column
        title="Actions"
        hint={`${semantic.length} semantic · ${interactions.length} interactions`}
      >
        <Sparkline times={detail.events.map((e) => new Date(e.receivedAt).getTime())} now={now} />
        <p className="mt-2 text-xs text-muted-foreground">
          {Object.entries(counts)
            .map(([k, v]) => `${v} ${words(k)}`)
            .join(" · ") || "no interactions yet"}
        </p>
        <ul className="mt-3 space-y-1.5">
          {[...semantic]
            .reverse()
            .slice(0, 40)
            .map((e) => (
              <li key={e.id} className="live-in flex items-start gap-2 text-xs">
                <span className="w-10 shrink-0 pt-0.5 tabular-nums text-muted-foreground">
                  {mmss(e.tMs)}
                </span>
                <div className="min-w-0 flex-1">
                  <span
                    className={`whitespace-nowrap rounded-md px-1.5 py-0.5 font-medium ${eventTone(e.semanticType ?? "")}`}
                  >
                    {words(e.semanticType ?? "semantic")}
                  </span>
                  <Refs payload={e.payload} />
                </div>
              </li>
            ))}
          {semantic.length === 0 ? (
            <Empty>No semantic events yet: the app reports them as the participant acts.</Empty>
          ) : null}
        </ul>
      </Column>

      <Column title="Recording" hint={s.completeness}>
        <ul className="space-y-2">
          {detail.assets.map((a) => (
            <li key={a.id} className="live-in rounded-xl border border-border/70 p-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium">{words(a.kind)}</span>
                <span className="flex items-center gap-1.5 capitalize text-muted-foreground">
                  {a.status === "recording" ? (
                    <span className="live-pulse size-1.5 rounded-full bg-destructive" />
                  ) : null}
                  {a.status}
                </span>
              </div>
              <p className="mt-1 text-muted-foreground">
                from {mmss(a.offsetMs)}
                {a.durationMs !== null ? ` · ${mmss(a.durationMs)} long` : ""}
                {a.providerStatus ? ` · provider ${a.providerStatus}` : ""}
                {a.transcriptStatus ? ` · transcript ${a.transcriptStatus}` : ""}
              </p>
              {a.failureReason ? <p className="mt-1 text-destructive">{a.failureReason}</p> : null}
            </li>
          ))}
          {detail.assets.length === 0 ? <Empty>No archive yet.</Empty> : null}
        </ul>
        {s.pauses.length ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Pauses:{" "}
            {s.pauses
              .map((p) => `${mmss(p.start_ms)}–${p.end_ms !== null ? mmss(p.end_ms) : "…"}`)
              .join(", ")}
          </p>
        ) : null}
      </Column>

      <Column title="Transcript" hint={words(s.transcriptStatus)}>
        {detail.transcript.length === 0 ? (
          <Empty>
            {s.transcriptStatus === "queued"
              ? "Transcribing the recording…"
              : s.transcriptStatus === "failed"
                ? "Transcription failed."
                : s.state === "recording"
                  ? "Arrives after the recording ends and uploads."
                  : "No transcript."}
          </Empty>
        ) : (
          <ul className="space-y-2">
            {detail.transcript.map((t) => (
              <li key={t.id} className="live-in text-xs">
                <span className="mr-2 tabular-nums text-muted-foreground">{mmss(t.startMs)}</span>
                <span className="leading-relaxed">{t.text}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs">
          <Link
            href={`/owner/sessions/${s.id}`}
            className="text-brand underline-offset-4 hover:underline"
          >
            Open evidence
          </Link>
        </p>
      </Column>
    </div>
  );
}

/* ---------------- Small pieces ---------------- */

function Column({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="surface flex min-h-[24rem] flex-col p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {hint ? <span className="truncate text-[11px] text-muted-foreground">{hint}</span> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">{children}</p>
  );
}

function Pill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${ok ? "bg-success/15 text-success" : "bg-secondary text-muted-foreground"}`}
    >
      <span className={`size-1.5 rounded-full ${ok ? "bg-success" : "bg-border"}`} />
      {label}
    </span>
  );
}

function StatePill({ state }: { state: string }) {
  return (
    <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] capitalize">
      {words(state)}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-secondary/70 px-3 py-2">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function Refs({ payload }: { payload: Record<string, unknown> }) {
  const shown = Object.entries(payload).filter(
    ([k]) => !["goal_source", "semantic_type"].includes(k),
  );
  if (shown.length === 0) return null;
  return (
    <span className="mt-0.5 block break-all text-[11px] text-muted-foreground">
      {shown.map(([k, v]) => `${words(k)} ${String(v)}`).join(" · ")}
    </span>
  );
}

function eventTone(type: string) {
  if (type === "help_request" || type === "validation_error")
    return "bg-destructive/10 text-destructive";
  if (type === "completion" || type === "action_result") return "bg-success/15 text-success";
  if (type === "journey_start" || type === "progress") return "bg-brand/10 text-brand";
  return "bg-secondary text-foreground";
}

/** Probability as a bar with an optional gate threshold marker. Values are model estimates. */
function Bar({ label, value, threshold }: { label: string; value: number; threshold?: number }) {
  const v = Math.max(0, Math.min(1, value));
  const passes = threshold !== undefined && v >= threshold;
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="capitalize text-muted-foreground">{label}</span>
        <span className={`tabular-nums ${passes ? "font-medium text-success" : ""}`}>{pct(v)}</span>
      </div>
      <div className="relative mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className={`h-full rounded-full transition-[width] duration-700 ease-out ${passes ? "bg-success" : "bg-brand"}`}
          style={{ width: `${v * 100}%` }}
        />
        {threshold !== undefined ? (
          <span
            className="absolute inset-y-0 w-px bg-foreground/50"
            style={{ left: `${threshold * 100}%` }}
          />
        ) : null}
      </div>
    </div>
  );
}

function Choice({ label, answer }: { label: string; answer: Answer | undefined }) {
  if (answer?.type !== "choice") return null;
  const probs = Object.entries(answer.probabilities ?? { [answer.choice]: answer.confidence }).sort(
    (a, b) => b[1] - a[1],
  );
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="capitalize">
          <span className="font-medium">{words(answer.choice)}</span>
          <span className="ml-1 tabular-nums text-muted-foreground">{pct(answer.confidence)}</span>
        </span>
      </div>
      <div className="mt-1 flex h-1.5 gap-px overflow-hidden rounded-full bg-secondary">
        {probs.map(([k, p]) => (
          <span
            key={k}
            title={`${words(k)} ${pct(p)}`}
            className={`h-full transition-[width] duration-700 ease-out ${k === answer.choice ? "bg-brand" : "bg-foreground/20"}`}
            style={{ width: `${p * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}

/** Events per 5-second bucket over the last two minutes; honest zeros where nothing arrived. */
function Sparkline({ times, now }: { times: number[]; now: number }) {
  const buckets = useMemo(() => {
    const n = 24;
    const size = 5000;
    const out = new Array<number>(n).fill(0);
    const start = now - n * size;
    for (const t of times) {
      const i = Math.floor((t - start) / size);
      if (i >= 0 && i < n) out[i] = (out[i] ?? 0) + 1;
    }
    return out;
  }, [times, now]);
  const max = Math.max(1, ...buckets);
  if (max === 1 && buckets.every((b) => b === 0)) return null;
  return (
    <div
      role="img"
      aria-label="events over the last two minutes"
      className="flex h-10 items-end gap-px"
    >
      {buckets.map((b, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed time buckets
          key={i}
          className={`flex-1 rounded-sm transition-[height] duration-500 ${b ? "bg-brand" : "bg-secondary"}`}
          style={{ height: `${Math.max(6, (b / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

function Coverage({ coverage }: { coverage: unknown }) {
  const c = coverage as { required?: string[]; observed?: string[]; missing?: string[] } | null;
  if (!c?.required?.length) return null;
  return (
    <p className="mt-1 flex flex-wrap gap-1">
      {c.required.map((r) => (
        <span
          key={r}
          className={`rounded-md px-1.5 py-0.5 text-[10px] ${c.missing?.includes(r) ? "bg-secondary text-muted-foreground line-through" : "bg-success/15 text-success"}`}
        >
          {words(r)}
        </span>
      ))}
    </p>
  );
}
