"use client";

import { useState } from "react";

/** Recorded demo run (2026-09-21, jev-1.13.0). Shown as an example, never as a benchmark. */
export const EXAMPLE_LOG = [
  ["0:04.1", "journey_start", "journey_id=share_drawing"],
  ["0:04.1", "progress", "progress_ref=drawing_started"],
  ["0:07.9", "action_attempt", "action_ref=share_button"],
  ["0:09.3", "action_result", "action_ref=share_button result=cancelled"],
  ["0:13.1", "action_attempt", "action_ref=save_to_file"],
  ["0:15.0", "action_result", "action_ref=save_to_file result=cancelled"],
  ["0:17.4", "help_request", "target_ref=help_dialog"],
  ["0:21.0", "navigation", "route_template=/menu/main"],
  ["0:22.6", "action_result", "action_ref=export_image result=success"],
  ["0:22.6", "completion", "progress_ref=image_exported"],
] as const;

const READING = [
  ["Friction observed", 0.95],
  ["Wrong path taken", 0.97],
  ["Recovered after help", 0.97],
  ["Research warranted", 0.81],
] as const;

const tone = (type: string) =>
  type === "help_request"
    ? "text-[#ff7b72]"
    : type === "action_result" || type === "completion"
      ? "text-[#5fd38d]"
      : type === "action_attempt"
        ? "text-[#f2cc60]"
        : type === "navigation"
          ? "text-[#79c0ff]"
          : "text-[#d2a8ff]";

/** The hero figure: a real semantic log and what Jev read into it. */
export function JourneyFigure({ compact = false }: { compact?: boolean }) {
  const rows = compact ? EXAMPLE_LOG.slice(2, 9) : EXAMPLE_LOG;
  return (
    <figure className="overflow-hidden rounded-2xl bg-[#0f1115] text-[#d8dbe2] shadow-[var(--shadow-float)]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2 text-[11px] text-white/50">
        <span className="font-medium text-white">A visitor wants an image of their drawing</span>
        <span className="font-mono">semantic log · excalidraw</span>
      </div>
      <div className="px-4 py-3 font-mono text-[11.5px] leading-[1.7]">
        {rows.map(([t, type, detail], i) => (
          <div
            key={t + type}
            className="live-in flex gap-2.5"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <span className="w-12 shrink-0 text-white/40">{t}</span>
            <span className={`w-28 shrink-0 ${tone(type)}`}>{type}</span>
            <span className="truncate text-white/75">{detail}</span>
          </div>
        ))}
      </div>
      {!compact ? (
        <div className="border-t border-white/10 bg-white/[0.03] px-4 py-3">
          <p className="mb-2 text-[11px] text-white/50">
            What Jev reads into it{" "}
            <span className="text-white/30">· evidence sufficient · share mistaken for export</span>
          </p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
            {READING.map(([label, v]) => (
              <div key={label}>
                <div className="flex justify-between text-[11px]">
                  <span className="text-white/60">{label}</span>
                  <span className="tabular-nums text-white">{Math.round(v * 100)}%</span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-[#6f7cff]"
                    style={{ width: `${v * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-[#5fd38d]">
            Above the gate → research candidate → study
          </p>
        </div>
      ) : null}
      <figcaption className="border-t border-white/10 px-4 py-2 text-[10.5px] text-white/40">
        From a recorded demo run, model jev-1.13.0. An example, not a benchmark.
      </figcaption>
    </figure>
  );
}

const STEPS = [
  {
    n: "01",
    title: "Observe",
    text: "Your app reports a small vocabulary of events: journey start, attempt, result, help, completion. With permission, never content.",
  },
  {
    n: "02",
    title: "Screen",
    text: "Deterministic triggers cut a bounded window. Jev estimates friction, wrong paths and whether research is warranted. Signals, not findings.",
  },
  {
    n: "03",
    title: "Study",
    text: "One neutral task for real people who think out loud. Actions and speech land on one clock. No screen recording needed.",
  },
  {
    n: "04",
    title: "Evidence",
    text: "Transcript, actions and answers become findings you can cite and issues you can file. Every number keeps its source.",
  },
];

/** Step list beside one visual; the visual follows the selected step. */
export function HowItWorks() {
  const [active, setActive] = useState(1);
  return (
    <div className="grid gap-10 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:items-center">
      <ol className="space-y-1">
        {STEPS.map((s, i) => {
          const on = i === active;
          return (
            <li key={s.n}>
              <button
                type="button"
                onClick={() => setActive(i)}
                className={`flex w-full gap-4 rounded-2xl px-5 text-left transition-all ${
                  on ? "bg-secondary/70 py-6" : "py-4 hover:bg-secondary/40"
                }`}
              >
                <span
                  className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full font-mono text-xs ${
                    on ? "bg-foreground text-background" : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {s.n}
                </span>
                <span className="min-w-0">
                  <span
                    className={`block text-lg tracking-tight ${on ? "font-medium" : "text-muted-foreground"}`}
                  >
                    {s.title}
                  </span>
                  {on ? (
                    <span className="mt-1.5 block max-w-md text-sm leading-relaxed text-muted-foreground">
                      {s.text}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="min-h-[22rem]">
        {active === 0 ? <JourneyFigure compact /> : null}
        {active === 1 ? <ScreenFlow /> : null}
        {active === 2 ? <StudyFigure /> : null}
        {active === 3 ? <EvidenceFigure /> : null}
      </div>
    </div>
  );
}

/** Trigger → window → Jev, drawn as a decision flow. */
function ScreenFlow() {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-6 md:p-8">
      <div className="grid grid-cols-[1fr_auto_1fr_auto_1.3fr] items-center gap-2 text-[13px]">
        <Node mono="0:17.4">help_request</Node>
        <Line />
        <Node>Window in the last 90 s?</Node>
        <div className="flex flex-col gap-1 self-stretch justify-between py-3">
          <Branch label="yes" on />
          <Branch label="no" />
        </div>
        <div className="flex flex-col gap-3">
          <Node strong mono="friction 95% · wrong path 97% · candidate">
            Jev evaluates the window
          </Node>
          <Node muted mono="no model call">
            keeps listening
          </Node>
        </div>
      </div>
      <p className="mt-6 text-xs text-muted-foreground">
        Triggers are code, not the model: a help request, a repeated failure, a navigation loop or
        the journey ending. Jev only reads what the trigger cut, bounded by budget and cooldown.
      </p>
    </div>
  );
}

function Node({
  children,
  mono,
  strong,
  muted,
}: {
  children: React.ReactNode;
  mono?: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-3.5 py-2.5 ${
        strong
          ? "border-foreground/60 shadow-sm"
          : muted
            ? "border-border/60 text-muted-foreground"
            : "border-border"
      }`}
    >
      <p className="font-medium leading-snug">{children}</p>
      {mono ? <p className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">{mono}</p> : null}
    </div>
  );
}

function Line() {
  return <span className="h-px w-6 bg-border" aria-hidden />;
}

function Branch({ label, on }: { label: string; on?: boolean }) {
  return (
    <span className="flex items-center gap-1">
      <span
        className={`h-px w-4 ${on ? "bg-foreground" : "border-t border-dashed border-border"}`}
      />
      <span
        className={`rounded-full px-2 py-0.5 font-mono text-[10.5px] ${
          on ? "bg-foreground text-background" : "border border-border text-muted-foreground"
        }`}
      >
        {label}
      </span>
      <span
        className={`h-px w-4 ${on ? "bg-foreground" : "border-t border-dashed border-border"}`}
      />
    </span>
  );
}

const STUDY_LOG = [
  ["0:07.2", "speech", "share… no, that's live collaboration, I just want a picture"],
  ["0:07.9", "action_attempt", "action_ref=share_button"],
  ["0:09.3", "action_result", "result=cancelled"],
  ["0:12.0", "speech", "save to… that gives me some dot excalidraw file"],
  ["0:15.0", "action_result", "action_ref=save_to_file result=cancelled"],
  ["0:17.4", "help_request", "target_ref=help_dialog"],
  ["0:21.9", "speech", "ah, it's in the menu on the top left, export image"],
  ["0:22.6", "completion", "progress_ref=image_exported"],
] as const;

/** Actions and speech on one clock, from the recorded study. */
function StudyFigure() {
  return (
    <figure className="overflow-hidden rounded-2xl bg-[#0f1115] text-[#d8dbe2] shadow-[var(--shadow-float)]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2 text-[11px] text-white/50">
        <span className="font-medium text-white">Participant, thinking out loud</span>
        <span className="font-mono">session log · audio only</span>
      </div>
      <div className="px-4 py-3 font-mono text-[11.5px] leading-[1.7]">
        {STUDY_LOG.map(([t, type, detail], i) => (
          <div key={t} className="live-in flex gap-2.5" style={{ animationDelay: `${i * 60}ms` }}>
            <span className="w-12 shrink-0 text-white/40">{t}</span>
            <span className={`w-28 shrink-0 ${type === "speech" ? "text-[#e9d8a6]" : tone(type)}`}>
              {type}
            </span>
            <span className={type === "speech" ? "italic text-[#e9d8a6]" : "text-white/75"}>
              {type === "speech" ? `“${detail}”` : detail}
            </span>
          </div>
        ))}
      </div>
      <figcaption className="border-t border-white/10 px-4 py-2 text-[10.5px] text-white/40">
        Synthesized voice in the demo; the transcript is the real SLNG output of that audio.
      </figcaption>
    </figure>
  );
}

/** A finding, the shape evidence takes at the end. */
function EvidenceFigure() {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-6 md:p-8">
      <p className="font-mono text-[11px] text-muted-foreground">
        finding · preliminary · 1 of 1 sessions
      </p>
      <h3 className="mt-2 text-xl font-medium tracking-tight">
        Export: Share is mistaken for image export
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        The participant tried Share and Save to before finding Export image in the main menu, and
        asked for help in between. The image was exported at 0:22.
      </p>
      <ul className="mt-4 space-y-1.5 font-mono text-[11px] text-muted-foreground">
        <li>cites action_result share_button cancelled · 0:09.3</li>
        <li>cites help_request help_dialog · 0:17.4</li>
        <li>cites transcript 0:07.2 “…I just want a picture”</li>
      </ul>
      <p className="mt-4 text-xs text-muted-foreground">
        Certainty and counts are computed by the server, never written by the model. Issues carry no
        transcript text, no session ids.
      </p>
    </div>
  );
}
