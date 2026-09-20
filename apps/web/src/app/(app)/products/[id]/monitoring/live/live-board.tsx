"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Wordmark } from "@/components/layout/shell";
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
type Question = { type: string; instructions: string; criteria?: unknown };
type LogLine = {
  id: string;
  tMs: number;
  kind: "semantic" | "interaction" | "speech" | "marker";
  type: string;
  detail: string;
};
type Kpi = { label: string; value: string; hint?: string; tone?: "warn" | "good" };

const POLL_MS = 1000;
const BASE_KEYS = [
  "ux_friction_observed",
  "targeted_research_warranted",
  "evidence_sufficiency",
  "problem_category",
];

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const clock = (ms: number) => `${mmss(ms)}.${String(Math.floor((Math.max(0, ms) % 1000) / 100))}`;
const ago = (iso: string, now: number) => {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};
const pct = (v: number) => `${Math.round(v * 100)}%`;
const words = (s: string) => s.replace(/_/g, " ");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const noul = (a: Answer | undefined) => (a?.type === "noul" ? a.noul : 0);
const LABELS: Record<string, string> = {
  ux_friction_observed: "UX friction observed",
  targeted_research_warranted: "Research warranted",
  evidence_sufficiency: "Evidence",
  problem_category: "Category",
};
const label = (k: string) => LABELS[k] ?? cap(words(k));

/**
 * Live analysis console. Polls persisted state every second; every row is a stored event,
 * window, evaluation, asset or transcript segment. Facts (counts, times) come from the events;
 * meaning (friction, detours, category) comes from Jev and is labeled as an estimate.
 */
export function LiveBoard({
  productId,
  productName,
  productUrl,
  productHref,
  ownerEmail,
  initial = null,
}: {
  productId: string;
  productName: string;
  productUrl: string;
  /** Breadcrumb target (slug URL of the monitoring page); API calls keep `productId`. */
  productHref: string;
  ownerEmail: string;
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
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => {
      stopped = true;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [productId]);

  const sessions = data?.sessions ?? [];
  const effective = pinned ?? data?.selectedRef ?? newest(sessions);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border/70 bg-card/80 px-3 text-xs backdrop-blur">
        <Wordmark className="text-sm" />
        <span className="text-border">/</span>
        <Link href={productHref} className="text-muted-foreground hover:text-foreground">
          {productName}
        </Link>
        <span className="text-border">/</span>
        <span className="font-medium">Live analysis</span>
        <div className="mx-2 min-w-0 flex-1 overflow-x-auto">
          {sessions.length > 0 ? (
            <SessionTabs
              sessions={sessions}
              selected={effective}
              following={pinned === null}
              onPick={(ref) => setPinned(ref)}
              onFollow={() => setPinned(null)}
            />
          ) : null}
        </div>
        {data ? (
          <>
            <Dot
              ok={data.product.policy.enabled}
              label={data.product.policy.enabled ? "collection on" : "collection off"}
            />
            <Dot ok={data.product.jev} label={data.product.jev ? "jev" : "jev off"} />
            <Dot
              ok={data.product.activeDetectors > 0}
              label={`${data.product.activeDetectors} detector${data.product.activeDetectors === 1 ? "" : "s"}`}
            />
          </>
        ) : null}
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span
            className={`size-1.5 rounded-full ${error ? "bg-destructive" : "live-pulse bg-success"}`}
          />
          {error ? error : updatedAt ? ago(new Date(updatedAt).toISOString(), now) : "connecting"}
        </span>
        <span className="hidden text-muted-foreground lg:inline">{ownerEmail}</span>
      </header>

      <main className="min-h-0 flex-1 p-2">
        {!data ? (
          <Center>Connecting…</Center>
        ) : sessions.length === 0 ? (
          <Waiting data={data} productUrl={productUrl} />
        ) : data.selected?.kind === "observation" ? (
          <ObservationBoard detail={data.selected} board={data} now={now} />
        ) : data.selected?.kind === "study" ? (
          <StudyBoard detail={data.selected} now={now} />
        ) : (
          <Center>Loading session…</Center>
        )}
      </main>
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

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function Waiting({ data, productUrl }: { data: Board; productUrl: string }) {
  const p = data.product.policy;
  return (
    <div className="flex h-full flex-col items-center justify-center rounded-xl border border-border/70 bg-card px-8 text-center">
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
        <p className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Passive collection is off for this product. Study sessions still show here.
        </p>
      ) : null}
      {!data.product.jev ? (
        <p className="mt-2 rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">
          Jev is not configured: windows will queue and stay unevaluated.
        </p>
      ) : null}
    </div>
  );
}

function SessionTabs({
  sessions,
  selected,
  following,
  onPick,
  onFollow,
}: {
  sessions: Session[];
  selected: LiveSessionRef | null;
  following: boolean;
  onPick: (ref: LiveSessionRef) => void;
  onFollow: () => void;
}) {
  const isSel = (s: Session) => selected?.kind === s.kind && selected.id === s.id;
  return (
    <div className="flex items-center gap-1">
      {sessions.slice(0, 8).map((s) => (
        <button
          key={`${s.kind}:${s.id}`}
          type="button"
          onClick={() => onPick({ kind: s.kind, id: s.id })}
          className={`flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 transition-colors ${
            isSel(s)
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground"
          }`}
        >
          <span
            className={`size-1.5 rounded-full ${s.live ? "live-pulse bg-success" : "bg-border"}`}
          />
          <span className="font-medium">{s.label}</span>
          <span className="opacity-70">{words(s.state)}</span>
          <span className="tabular-nums opacity-60">{s.events}</span>
        </button>
      ))}
      {sessions.length > 8 ? (
        <select
          className="h-7 rounded-md border border-border bg-card px-1.5"
          value={selected ? `${selected.kind}:${selected.id}` : ""}
          onChange={(e) => {
            const [kind, id] = e.target.value.split(":") as ["observation" | "study", string];
            if (kind && id) onPick({ kind, id });
          }}
        >
          {sessions.map((s) => (
            <option key={`${s.kind}:${s.id}`} value={`${s.kind}:${s.id}`}>
              {s.label} · {words(s.state)} · {s.events}
            </option>
          ))}
        </select>
      ) : null}
      <button
        type="button"
        onClick={onFollow}
        className={`shrink-0 rounded-md px-2 py-1 transition-colors ${
          following ? "bg-brand/10 text-brand" : "text-muted-foreground hover:bg-secondary"
        }`}
      >
        {following ? "following newest" : "follow newest"}
      </button>
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
  const evaluations = detail.evaluations;
  const evaluatedJourney = evaluations[0]?.window?.journeyInstanceId;
  const journey =
    detail.journeys.find((j) => j.journeyInstanceId === evaluatedJourney) ??
    [...detail.journeys].sort((a, b) => b.metrics.events - a.metrics.events)[0] ??
    null;
  const m = journey?.metrics ?? null;
  const latest = evaluations.find((e) => e.status === "completed") ?? null;
  const running = evaluations.find((e) => e.status === "queued" || e.status === "running");
  const lastAt = detail.session.lastEventAt ? new Date(detail.session.lastEventAt).getTime() : null;
  const latestWindowAt = evaluations[0] ? new Date(evaluations[0].requestedAt).getTime() : 0;
  const scanDue =
    lastAt && lastAt > latestWindowAt
      ? Math.max(0, lastAt + board.product.policy.batchDelayMs - now)
      : null;
  const lines: LogLine[] = events.map((e) => ({
    id: e.id,
    tMs: e.tMs,
    kind: "semantic",
    type: e.type,
    detail: refs(e.payload),
  }));
  const answers = (latest?.answers ?? {}) as Record<string, Answer>;
  const friction = latest ? noul(answers.ux_friction_observed) : null;
  const completedCount = evaluations.filter((e) => e.status === "completed").length;
  const kpis: Kpi[] = [
    { label: "Journey time", value: m ? mmss(m.durationMs) : "—" },
    {
      label: "Events",
      value: String(events.length),
      hint: `${detail.journeys.length} journey${detail.journeys.length === 1 ? "" : "s"}`,
    },
    {
      label: "Attempts",
      value: m ? String(m.attempts) : "—",
      hint: m?.distinctActions.length ? m.distinctActions.map(words).join(", ") : undefined,
    },
    {
      label: "Detours",
      value: m ? String(m.detours) : "—",
      tone: (m?.detours ?? 0) > 0 ? "warn" : undefined,
      hint: m?.firstDetourMs != null ? `first at ${mmss(m.firstDetourMs)}` : undefined,
    },
    {
      label: "Help requests",
      value: m ? String(m.helpRequests) : "—",
      tone: (m?.helpRequests ?? 0) > 0 ? "warn" : undefined,
    },
    {
      label: "Outcome",
      value: m ? cap(words(m.outcome)) : "—",
      hint: m?.timeToGoalMs != null ? `goal in ${mmss(m.timeToGoalMs)}` : undefined,
      tone: m?.outcome === "completed" ? "good" : undefined,
    },
    {
      label: "Jev friction",
      value: friction !== null ? pct(friction) : running ? "…" : "—",
      hint: latest ? `${completedCount} evaluation${completedCount === 1 ? "" : "s"}` : undefined,
      tone:
        friction !== null && friction >= board.product.policy.frictionThreshold
          ? "warn"
          : undefined,
    },
    {
      label: "Candidate",
      value: detail.candidates.length ? cap(words(detail.candidates[0]?.state ?? "")) : "None",
      hint: detail.candidates[0] ? words(detail.candidates[0].category) : undefined,
      tone: detail.candidates.length > 0 ? "good" : undefined,
    },
  ];

  return (
    <div className="grid h-full min-h-0 grid-cols-12 gap-2">
      <LogPanel
        className="col-span-12 lg:col-span-4"
        title="Instrumentation log"
        hint={journey ? `${journey.journeyId} · ${journey.journeyInstanceId}` : "no journey yet"}
        lines={lines}
        live={
          scanDue !== null
            ? `scan in ${Math.ceil(scanDue / 1000)}s`
            : running
              ? "Jev evaluating…"
              : "listening"
        }
      />
      <div className="col-span-12 flex min-h-0 flex-col gap-2 lg:col-span-5">
        <KpiGrid items={kpis} />
        <Panel
          title="Journey timeline"
          hint="events by type · shaded ranges are the windows Jev saw"
        >
          <Timeline events={events} evaluations={evaluations} />
        </Panel>
        <Panel
          title="What Jev reads into it"
          hint={
            board.product.jev ? "typesafe.ai systemone · estimates, not findings" : "not configured"
          }
          className="min-h-0 flex-1"
          scroll
        >
          {latest ? (
            <JevReading ev={latest} board={board} />
          ) : running ? (
            <p className="flex items-center gap-2 text-xs">
              <span className="live-pulse size-1.5 rounded-full bg-brand" />
              {words(running.triggerReason)} window sent · waiting for the model
            </p>
          ) : (
            <Empty>
              {events.length === 0
                ? "Waiting for a journey."
                : "No trigger yet: a help request, a repeated failure, a navigation loop or the journey ending starts a window."}
            </Empty>
          )}
        </Panel>
      </div>
      <div className="col-span-12 flex min-h-0 flex-col gap-2 lg:col-span-3">
        <Panel
          title="Research candidates"
          hint={`gate ≥ ${pct(board.product.policy.frictionThreshold)} / ≥ ${pct(board.product.policy.researchThreshold)}`}
          className="max-h-[55%] min-h-0 shrink-0"
          scroll
        >
          {detail.candidates.length === 0 ? (
            <Empty>
              {latest
                ? "Below the gate for this session: no candidate."
                : "Appears when an evaluation passes the gate."}
            </Empty>
          ) : (
            <ul className="space-y-2">
              {detail.candidates.map((c) => (
                <li key={c.id} className="live-in rounded-lg border border-border/70 p-2.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="font-medium capitalize">{words(c.category)}</span>
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[10.5px] capitalize">
                      {words(c.state)}
                    </span>
                  </div>
                  <p className="mt-1 leading-snug">{c.suspectedProblem}</p>
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
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
                  <p className="mt-1.5 text-muted-foreground">
                    {c.distinctObservationSessions} session
                    {c.distinctObservationSessions === 1 ? "" : "s"} · {ago(c.updatedAt, now)}
                    {c.evidenceLimitations.length ? ` · ${c.evidenceLimitations.join("; ")}` : ""}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <CandidateActions
                      candidateId={c.id}
                      state={c.state}
                      devinReady={board.product.devin}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel
          title="Evaluations"
          hint={`${evaluations.length} on this session`}
          className="min-h-0 flex-1"
          scroll
        >
          {evaluations.length === 0 ? (
            <Empty>None yet.</Empty>
          ) : (
            <ul className="divide-y divide-border/60 text-xs">
              {evaluations.map((e) => {
                const a = (e.answers ?? {}) as Record<string, Answer>;
                const isRunning = e.status === "queued" || e.status === "running";
                return (
                  <li key={e.id} className="live-in py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 capitalize">
                        {isRunning ? (
                          <span className="live-pulse size-1.5 rounded-full bg-brand" />
                        ) : null}
                        {words(e.triggerReason)}
                      </span>
                      <span className="text-muted-foreground">{ago(e.requestedAt, now)}</span>
                    </div>
                    <p className="mt-0.5 tabular-nums text-muted-foreground">
                      {e.status === "completed"
                        ? `friction ${pct(noul(a.ux_friction_observed))} · research ${pct(noul(a.targeted_research_warranted))} · ${e.returnedModel ?? ""}${e.latencyMs !== null ? ` · ${(e.latencyMs / 1000).toFixed(1)}s` : ""}`
                        : `${words(e.status)}${e.statusReason ? ` · ${e.statusReason}` : ""}`}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

/** The latest completed evaluation, read as meaning: every answer next to the question it answers. */
function JevReading({ ev, board }: { ev: Evaluation; board: Board }) {
  const answers = (ev.answers ?? {}) as Record<string, Answer>;
  const questions = (ev.questions ?? {}) as Record<string, Question>;
  const friction = noul(answers.ux_friction_observed);
  const research = noul(answers.targeted_research_warranted);
  const evidence = answers.evidence_sufficiency;
  const category = answers.problem_category;
  const passes =
    friction >= board.product.policy.frictionThreshold &&
    research >= board.product.policy.researchThreshold &&
    evidence?.type === "choice" &&
    evidence.choice !== "insufficient";
  const extra = Object.keys(answers).filter((k) => !BASE_KEYS.includes(k));
  return (
    <div className="live-in">
      <p className="text-[13px] leading-snug">
        {evidence?.type === "choice" ? (
          <>
            Evidence <b>{words(evidence.choice)}</b> ·{" "}
          </>
        ) : null}
        friction <b>{pct(friction)}</b> · research warranted <b>{pct(research)}</b>
        {category?.type === "choice" ? (
          <>
            {" "}
            · category <b>{words(category.choice)}</b> ({pct(category.confidence)})
          </>
        ) : null}
      </p>
      <p className={`mt-0.5 text-xs ${passes ? "text-success" : "text-muted-foreground"}`}>
        {passes
          ? "Above the gate: this becomes (or updates) a research candidate."
          : `Below the gate: needs friction ≥ ${pct(board.product.policy.frictionThreshold)}, research ≥ ${pct(board.product.policy.researchThreshold)}, evidence not insufficient.`}
      </p>
      <div className="mt-2.5 grid gap-x-5 gap-y-2.5 sm:grid-cols-2">
        <AnswerTile
          k="ux_friction_observed"
          a={answers.ux_friction_observed}
          q={questions.ux_friction_observed}
          threshold={board.product.policy.frictionThreshold}
        />
        <AnswerTile
          k="targeted_research_warranted"
          a={answers.targeted_research_warranted}
          q={questions.targeted_research_warranted}
          threshold={board.product.policy.researchThreshold}
        />
        <AnswerTile k="evidence_sufficiency" a={evidence} q={questions.evidence_sufficiency} />
        <AnswerTile k="problem_category" a={category} q={questions.problem_category} />
        {extra.map((k) => (
          <AnswerTile key={k} k={k} a={answers[k]} q={questions[k]} />
        ))}
      </div>
      <p className="mt-2.5 text-[11px] text-muted-foreground">
        {ev.returnedModel ?? ev.requestedModel} · {words(ev.triggerReason)} window of{" "}
        {ev.window?.events ?? 0} events
        {ev.latencyMs !== null ? ` · ${(ev.latencyMs / 1000).toFixed(1)}s` : ""}
        {ev.inputTokens !== null
          ? ` · ${ev.inputTokens} in / ${ev.outputTokens ?? 0} out tokens`
          : ""}
        {ev.estimatedCostMicros !== null
          ? ` · $${(ev.estimatedCostMicros / 1_000_000).toFixed(4)}`
          : ""}
      </p>
      {ev.state ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
            State sent to Jev
          </summary>
          <pre className="mt-1 max-h-56 overflow-auto rounded-md bg-secondary/70 p-2 font-mono text-[10px] leading-relaxed">
            {JSON.stringify(ev.state, null, 1)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

function AnswerTile({
  k,
  a,
  q,
  threshold,
}: {
  k: string;
  a: Answer | undefined;
  q: Question | undefined;
  threshold?: number;
}) {
  if (!a) return null;
  return (
    <div>
      {a.type === "noul" ? (
        <Bar label={label(k)} value={a.noul} threshold={threshold} />
      ) : a.type === "choice" ? (
        <Choice label={label(k)} answer={a} />
      ) : (
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">{label(k)}</span>
          <span className="tabular-nums">{a.score}</span>
        </div>
      )}
      {q?.instructions ? (
        <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-muted-foreground/80">
          {q.instructions}
        </p>
      ) : null}
    </div>
  );
}

/* ---------------- Study (opted-in task) session ---------------- */

function StudyBoard({ detail, now }: { detail: StudyDetail; now: number }) {
  const s = detail.session;
  const m = detail.metrics;
  const interactions = detail.events.filter((e) => e.type !== "semantic");
  const started = s.startedAt ? new Date(s.startedAt).getTime() : null;
  const ended = s.endedAt ? new Date(s.endedAt).getTime() : null;
  const elapsed = started ? (ended ?? now) - started : 0;
  const lines: LogLine[] = [
    ...detail.events.map((e): LogLine => {
      if (e.type === "semantic")
        return {
          id: e.id,
          tMs: e.tMs,
          kind: "semantic",
          type: e.semanticType ?? "semantic",
          detail: refs(e.payload),
        };
      if (e.type === "task_marker")
        return {
          id: e.id,
          tMs: e.tMs,
          kind: "marker",
          type: String(e.payload.label ?? "marker"),
          detail: "",
        };
      return { id: e.id, tMs: e.tMs, kind: "interaction", type: e.type, detail: refs(e.payload) };
    }),
    ...detail.transcript.map(
      (t): LogLine => ({
        id: t.id,
        tMs: t.startMs,
        kind: "speech",
        type: "speech",
        detail: t.text,
      }),
    ),
  ].sort((a, b) => a.tMs - b.tMs);
  const asset = detail.assets[0];
  const kpis: Kpi[] = [
    { label: "Elapsed", value: mmss(elapsed) },
    { label: "Actions", value: String(m.events), hint: `${interactions.length} interactions` },
    {
      label: "Attempts",
      value: String(m.attempts),
      hint: m.distinctActions.length ? m.distinctActions.map(words).join(", ") : undefined,
    },
    {
      label: "Detours",
      value: String(m.detours),
      tone: m.detours > 0 ? "warn" : undefined,
      hint: m.firstDetourMs != null ? `first at ${mmss(m.firstDetourMs)}` : undefined,
    },
    {
      label: "Help requests",
      value: String(m.helpRequests),
      tone: m.helpRequests > 0 ? "warn" : undefined,
    },
    {
      label: "Outcome",
      value: cap(words(m.outcome)),
      hint:
        m.timeToGoalMs != null
          ? `goal in ${mmss(m.timeToGoalMs)}`
          : s.participantReportedOutcome !== "unknown"
            ? `reported ${words(s.participantReportedOutcome)}`
            : undefined,
      tone: m.outcome === "completed" ? "good" : undefined,
    },
    {
      label: "Recording",
      value: asset ? cap(asset.status) : cap(words(s.state)),
      hint:
        asset?.durationMs != null
          ? `${mmss(asset.durationMs)} audio`
          : `${s.pauses.length} pause${s.pauses.length === 1 ? "" : "s"}`,
      tone: asset?.status === "verified" ? "good" : undefined,
    },
    {
      label: "Transcript",
      value: cap(s.transcriptStatus),
      hint: detail.transcript.length
        ? `${detail.transcript.length} segment${detail.transcript.length === 1 ? "" : "s"}`
        : undefined,
      tone: s.transcriptStatus === "done" ? "good" : undefined,
    },
  ];
  return (
    <div className="grid h-full min-h-0 grid-cols-12 gap-2">
      <LogPanel
        className="col-span-12 lg:col-span-4"
        title="Session log"
        hint="actions and speech on one clock"
        lines={lines}
        live={
          s.state === "recording"
            ? "recording"
            : s.transcriptStatus === "queued"
              ? "transcribing…"
              : ended
                ? "ended"
                : "waiting"
        }
      />
      <div className="col-span-12 flex min-h-0 flex-col gap-2 lg:col-span-5">
        <KpiGrid items={kpis} />
        <Panel title="Journey timeline" hint="semantic events on the session clock">
          <Timeline
            events={detail.events
              .filter((e) => e.type === "semantic")
              .map((e) => ({ id: e.id, tMs: e.tMs, type: e.semanticType ?? "semantic" }))}
            evaluations={[]}
          />
        </Panel>
        <Panel
          title="Transcript"
          hint={words(s.transcriptStatus)}
          className="min-h-0 flex-1"
          scroll
        >
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
            <ul className="space-y-1.5 text-[13px] leading-relaxed">
              {detail.transcript.map((t) => (
                <li key={t.id} className="live-in">
                  <span className="mr-2 font-mono text-[11px] text-muted-foreground">
                    {mmss(t.startMs)}
                  </span>
                  {t.text}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <div className="col-span-12 flex min-h-0 flex-col gap-2 lg:col-span-3">
        <Panel title="Task" hint={`${words(s.channel ?? "")} · ${words(s.state)}`}>
          {s.task ? (
            <>
              <p className="text-[13px] leading-snug">{s.task.prompt}</p>
              <p className="mt-1.5 text-xs text-muted-foreground">Question: {s.task.question}</p>
            </>
          ) : null}
          <p className="mt-2 text-xs text-muted-foreground">
            microphone {s.capture?.microphone ?? "—"} · screen {s.capture?.screen ?? "—"} ·{" "}
            {s.pauses.length} pause{s.pauses.length === 1 ? "" : "s"}
          </p>
        </Panel>
        <Panel title="Recording" hint={s.completeness} className="min-h-0 flex-1" scroll>
          {detail.assets.length === 0 ? (
            <Empty>No archive yet.</Empty>
          ) : (
            <ul className="space-y-2 text-xs">
              {detail.assets.map((a) => (
                <li key={a.id} className="live-in rounded-lg border border-border/70 p-2.5">
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
                  {a.failureReason ? (
                    <p className="mt-1 text-destructive">{a.failureReason}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs">
            <Link
              href={`/owner/sessions/${s.id}`}
              className="text-brand underline-offset-4 hover:underline"
            >
              Open evidence
            </Link>
          </p>
        </Panel>
      </div>
    </div>
  );
}

/* ---------------- Panels ---------------- */

function Panel({
  title,
  hint,
  children,
  className = "",
  scroll = false,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
  scroll?: boolean;
}) {
  return (
    <section className={`flex flex-col rounded-xl border border-border/70 bg-card ${className}`}>
      <div className="flex shrink-0 items-baseline justify-between gap-2 border-b border-border/60 px-3 py-1.5">
        <h2 className="text-xs font-semibold tracking-tight">{title}</h2>
        {hint ? <span className="truncate text-[10.5px] text-muted-foreground">{hint}</span> : null}
      </div>
      <div className={`px-3 py-2 ${scroll ? "min-h-0 flex-1 overflow-y-auto" : ""}`}>
        {children}
      </div>
    </section>
  );
}

function KpiGrid({ items }: { items: Kpi[] }) {
  return (
    <dl className="grid shrink-0 grid-cols-4 gap-2">
      {items.map((it) => (
        <div key={it.label} className="rounded-xl border border-border/70 bg-card px-3 py-2">
          <dt className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
            {it.label}
          </dt>
          <dd
            className={`text-lg font-semibold leading-tight tabular-nums ${it.tone === "warn" ? "text-destructive" : it.tone === "good" ? "text-success" : ""}`}
          >
            {it.value}
          </dd>
          <p className="h-3.5 truncate text-[10.5px] text-muted-foreground">{it.hint ?? ""}</p>
        </div>
      ))}
    </dl>
  );
}

/** Terminal-style stream of stored events; newest at the bottom, auto-scrolled while it grows. */
function LogPanel({
  title,
  hint,
  lines,
  live,
  className = "",
}: {
  title: string;
  hint: string;
  lines: LogLine[];
  live: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const count = lines.length;
  useEffect(() => {
    const el = ref.current;
    if (el && count >= 0) el.scrollTop = el.scrollHeight;
  }, [count]);
  return (
    <section
      className={`flex min-h-[20rem] flex-col overflow-hidden rounded-xl bg-[#0f1115] text-[#d8dbe2] ${className}`}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3 py-1.5">
        <h2 className="text-xs font-semibold tracking-tight text-white">{title}</h2>
        <span className="truncate font-mono text-[10.5px] text-white/50">{hint}</span>
      </div>
      <div
        ref={ref}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[11.5px] leading-[1.65]"
      >
        {lines.length === 0 ? <p className="text-white/40">No events yet.</p> : null}
        {lines.map((l) => (
          <div key={l.id} className="live-in flex gap-2.5">
            <span className="w-14 shrink-0 tabular-nums text-white/40">{clock(l.tMs)}</span>
            <span className={`w-28 shrink-0 truncate ${logTone(l)}`}>
              {l.kind === "speech" ? "speech" : l.kind === "marker" ? `marker:${l.type}` : l.type}
            </span>
            <span
              className={`min-w-0 break-words ${l.kind === "speech" ? "italic text-[#e9d8a6]" : l.kind === "interaction" ? "text-white/45" : "text-white/80"}`}
            >
              {l.kind === "speech" ? `“${l.detail}”` : l.detail}
            </span>
          </div>
        ))}
        <div className="mt-1 flex items-center gap-2 text-white/40">
          <span className="live-pulse inline-block size-1.5 rounded-full bg-[#5fd38d]" />
          {live}
        </div>
      </div>
    </section>
  );
}

function logTone(l: LogLine) {
  if (l.kind === "speech") return "text-[#e9d8a6]";
  if (l.kind === "marker") return "text-[#9aa4ff]";
  if (l.kind === "interaction") return "text-white/35";
  if (l.type === "help_request" || l.type === "validation_error") return "text-[#ff7b72]";
  if (l.type === "action_result" || l.type === "completion") return "text-[#5fd38d]";
  if (l.type === "action_attempt") return "text-[#f2cc60]";
  if (l.type === "navigation") return "text-[#79c0ff]";
  return "text-[#d2a8ff]";
}

/** Events as dots on lanes by type, over the journey clock; evaluation windows shaded behind. */
function Timeline({
  events,
  evaluations,
}: {
  events: { id: string; tMs: number; type: string }[];
  evaluations: Evaluation[];
}) {
  const lanes = [
    "progress",
    "navigation",
    "action_attempt",
    "action_result",
    "help_request",
    "completion",
  ];
  const laneOf = (t: string) => {
    const i = lanes.indexOf(t);
    return i === -1 ? lanes.length : i;
  };
  const maxT = Math.max(
    30_000,
    ...events.map((e) => e.tMs),
    ...evaluations.map((e) => e.window?.endMs ?? 0),
  );
  const W = 1000;
  const laneH = 13;
  const H = (lanes.length + 1) * laneH + 18;
  const x = (t: number) => 62 + (t / maxT) * (W - 70);
  const y = (lane: number) => 6 + lane * laneH + laneH / 2;
  const fills: Record<string, string> = {
    progress: "#6f7cff",
    navigation: "#3b9dff",
    action_attempt: "#e6b422",
    action_result: "#2fb26a",
    help_request: "#e5484d",
    completion: "#2fb26a",
  };
  const ticks = useMemo(() => {
    const step = maxT <= 60_000 ? 10_000 : maxT <= 180_000 ? 30_000 : 60_000;
    const out: number[] = [];
    for (let t = 0; t <= maxT; t += step) out.push(t);
    return out;
  }, [maxT]);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label="journey timeline"
    >
      {evaluations.map((e) =>
        e.window ? (
          <rect
            key={e.id}
            x={x(e.window.startMs)}
            y={3}
            width={Math.max(2, x(e.window.endMs) - x(e.window.startMs))}
            height={H - 20}
            rx={3}
            fill={e.status === "completed" ? "rgba(111,124,255,0.10)" : "rgba(0,0,0,0.05)"}
          />
        ) : null,
      )}
      {[...lanes, "other"].map((lane, i) => (
        <g key={lane}>
          <text x={0} y={y(i) + 3} fontSize={9.5} fill="currentColor" opacity={0.55}>
            {words(lane)}
          </text>
          <line x1={62} x2={W - 8} y1={y(i)} y2={y(i)} stroke="currentColor" strokeOpacity={0.08} />
        </g>
      ))}
      {ticks.map((t) => (
        <text
          key={t}
          x={x(t)}
          y={H - 4}
          fontSize={8.5}
          fill="currentColor"
          opacity={0.45}
          textAnchor="middle"
        >
          {mmss(t)}
        </text>
      ))}
      {events.map((e) => (
        <circle
          key={e.id}
          cx={x(e.tMs)}
          cy={y(laneOf(e.type))}
          r={e.type === "completion" || e.type === "help_request" ? 4.5 : 3}
          fill={fills[e.type] ?? "#9aa0a6"}
          className="live-in"
        />
      ))}
    </svg>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg bg-secondary/60 px-2.5 py-1.5 text-xs text-muted-foreground">
      {children}
    </p>
  );
}

function Dot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${ok ? "text-success" : "text-muted-foreground"}`}
    >
      <span className={`size-1.5 rounded-full ${ok ? "bg-success" : "bg-border"}`} />
      {label}
    </span>
  );
}

function refs(payload: Record<string, unknown>) {
  return Object.entries(payload)
    .filter(([k]) => !["goal_source", "semantic_type", "viewport", "coordinates"].includes(k))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join("  ");
}

/** Probability as a bar with an optional gate threshold marker. Values are model estimates. */
function Bar({ label, value, threshold }: { label: string; value: number; threshold?: number }) {
  const v = Math.max(0, Math.min(1, value));
  const passes = threshold !== undefined && v >= threshold;
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{cap(label)}</span>
        <span className={`tabular-nums ${passes ? "font-medium text-success" : ""}`}>{pct(v)}</span>
      </div>
      <div className="relative mt-0.5 h-1.5 overflow-hidden rounded-full bg-secondary">
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
        <span className="text-muted-foreground">{cap(label)}</span>
        <span className="capitalize">
          <span className="font-medium">{words(answer.choice)}</span>
          <span className="ml-1 tabular-nums text-muted-foreground">{pct(answer.confidence)}</span>
        </span>
      </div>
      <div className="mt-0.5 flex h-1.5 gap-px overflow-hidden rounded-full bg-secondary">
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
