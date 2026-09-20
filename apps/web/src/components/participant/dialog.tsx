"use client";

import type {
  DialogMode,
  DialogToHostMessage,
  HostToDialogMessage,
} from "@vibecheck/contracts/embed";
import {
  Camera,
  CameraOff,
  Check,
  Hand,
  Keyboard,
  Mic,
  Monitor,
  MousePointerClick,
  Pause,
  Play,
  Timer,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LogoMark } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AssignmentView } from "@/domain/assignment-view";
import { type Api, makeApi } from "./api";
import { type SessionInfo, useRecorder } from "./use-recorder";

export const CONSENT_VERSION = "consent_v1";

type Step =
  | "task"
  | "consent"
  | "device_check"
  | "recording"
  | "outcome"
  | "done"
  | "withdrawn"
  | "incomplete";

const STEP_FOR_STATE: Record<string, Step> = {
  assigned: "task",
  consent: "device_check",
  device_check: "device_check",
  recording: "recording",
  submitting: "outcome",
  complete: "done",
  withdrawn: "withdrawn",
};

const MODE_FOR_STEP: Record<Step, DialogMode> = {
  task: "modal",
  consent: "modal",
  device_check: "modal",
  recording: "panel",
  outcome: "modal",
  done: "modal",
  withdrawn: "modal",
  incomplete: "modal",
};

export type DialogHost =
  | { kind: "iframe" }
  | { kind: "page"; productUrl: string; permittedOrigins: string[] };

/**
 * The participant dialog: task → consent → devices → recording → feedback. Renders inside the
 * SDK's iframe on the product page, or on the hosted recorder page for products without the SDK.
 */
export function ParticipantDialog({
  assignmentId,
  token,
  host,
  providersReady,
}: {
  assignmentId: string;
  token: string | null;
  host: DialogHost;
  providersReady: boolean;
}) {
  const api = useMemo(() => makeApi(token), [token]);
  const [view, setView] = useState<AssignmentView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("task");
  const hostOriginRef = useRef<string | null>(null);
  const targetWindowRef = useRef<Window | null>(null);
  const sessionRef = useRef<SessionInfo | null>(null);
  const [instrumented, setInstrumented] = useState(false);
  const hostFocusRef = useRef<((focused: boolean) => void) | null>(null);
  const autoPausedRef = useRef(false);

  // Load the assignment.
  useEffect(() => {
    api
      .get<AssignmentView>(`/api/assignments/${assignmentId}`)
      .then((v) => {
        setView(v);
        setStep(STEP_FOR_STATE[v.assignment.state] ?? "incomplete");
      })
      .catch((e: Error) => setLoadError(e.message));
  }, [api, assignmentId]);

  // Messaging with whoever hosts the instrumented page: the parent (iframe) or a window we opened.
  const postToHost = useCallback(
    (message: DialogToHostMessage) => {
      if (host.kind === "iframe") {
        const target = window.parent;
        if (message.type === "vibecheck:session") {
          if (hostOriginRef.current) target.postMessage(message, hostOriginRef.current);
          return;
        }
        target.postMessage(message, "*"); // ui/close carry no secrets
      } else if (
        message.type === "vibecheck:session" &&
        targetWindowRef.current &&
        hostOriginRef.current
      ) {
        targetWindowRef.current.postMessage(message, hostOriginRef.current);
      } else if (message.type === "vibecheck:stop") {
        targetWindowRef.current?.postMessage(message, "*");
      }
    },
    [host.kind],
  );

  useEffect(() => {
    if (!view) return;
    function onMessage(event: MessageEvent) {
      if (!view?.product.permittedOrigins.includes(event.origin)) return;
      const data = event.data as HostToDialogMessage | { type?: string } | null;
      if (!data || typeof data !== "object") return;
      if (data.type === "vibecheck:host" || data.type === "vibecheck:ready") {
        hostOriginRef.current = event.origin;
        if (host.kind === "page") targetWindowRef.current = event.source as Window | null;
        if (sessionRef.current) postToHost({ type: "vibecheck:session", ...sessionRef.current });
      }
      if (data.type === "vibecheck:instrumented") setInstrumented(true);
      if (data.type === "vibecheck:host-focus" && "focused" in data) {
        hostFocusRef.current?.(data.focused === true);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [view, host.kind, postToHost]);

  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const report = () => {
      const height = rootRef.current
        ? Math.ceil(rootRef.current.getBoundingClientRect().height)
        : undefined;
      postToHost({ type: "vibecheck:ui", mode: MODE_FOR_STEP[step], height });
    };
    report();
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [step, postToHost]);

  const onSession = useCallback(
    (s: SessionInfo) => {
      sessionRef.current = s;
      if (host.kind === "page") {
        targetWindowRef.current = window.open(host.productUrl, "vibecheck-target");
      } else {
        postToHost({ type: "vibecheck:session", ...s });
      }
    },
    [host, postToHost],
  );

  const rec = useRecorder({ api, assignmentId, onSession });
  const audioOnly = view?.assignment.capturePolicy.screen === "off";

  // Auto-pause while the participant is away from the window; resume when they return,
  // unless they paused on purpose themselves.
  useEffect(() => {
    hostFocusRef.current = (focused) => {
      if (rec.status !== "recording") return;
      if (!focused && !rec.paused) {
        autoPausedRef.current = true;
        void rec.pause();
      } else if (focused && rec.paused && autoPausedRef.current) {
        autoPausedRef.current = false;
        void rec.resume();
      }
    };
  }, [rec]);

  useEffect(() => {
    if (rec.status === "recording") setStep("recording");
    if (rec.status === "failed") setStep("incomplete");
  }, [rec.status]);

  async function finish(reason: "finished" | "finished_early" | "stuck" | "withdraw") {
    postToHost({ type: "vibecheck:stop" });
    await rec.finish(reason);
    setStep(reason === "withdraw" ? "withdrawn" : "outcome");
  }

  if (loadError)
    return (
      <Frame
        title="Could not load this task"
        body={loadError}
        onClose={() => postToHost({ type: "vibecheck:close" })}
      />
    );
  if (!view) return <Frame title="Loading…" body="" />;

  const minutes = Math.max(1, Math.round(view.task.timeLimitSeconds / 60));

  if (step === "recording") {
    return (
      <div ref={rootRef}>
        <RecordingPanel
          prompt={view.task.participantPrompt}
          paused={rec.paused}
          sessionMs={rec.sessionMs}
          instrumented={instrumented || host.kind === "iframe"}
          error={rec.error}
          onPause={() => {
            autoPausedRef.current = false;
            void rec.pause();
          }}
          onResume={() => {
            autoPausedRef.current = false;
            void rec.resume();
          }}
          onStuck={() => void rec.markStuck()}
          onDone={() => void finish("finished")}
          onEarly={() => void finish("finished_early")}
          onWithdraw={() => void finish("withdraw")}
        />
      </div>
    );
  }

  return (
    <div ref={rootRef}>
      <Frame
        title={
          step === "task"
            ? `Your task in ${view.product.name}`
            : step === "consent"
              ? "What is recorded"
              : step === "device_check"
                ? audioOnly
                  ? "Your microphone"
                  : "Share screen and microphone"
                : step === "outcome"
                  ? "How did it go?"
                  : step === "done"
                    ? "Thank you"
                    : step === "withdrawn"
                      ? "You withdrew"
                      : "Recording incomplete"
        }
        step={step}
        onClose={
          step === "done" || step === "withdrawn" || step === "incomplete"
            ? () => postToHost({ type: "vibecheck:close" })
            : step === "task" || step === "consent" || step === "device_check"
              ? () => void finish("withdraw")
              : undefined
        }
      >
        {step === "task" ? (
          <>
            {view.task.scenario ? (
              <div className="space-y-3 text-[15px] leading-snug">
                <p>{view.task.scenario.intro}</p>
                <ol className="list-decimal space-y-1 pl-5">
                  {view.task.scenario.steps
                    .slice()
                    .sort((a, b) => a.order - b.order)
                    .map((scenarioStep) => (
                      <li key={scenarioStep.order}>{scenarioStep.instruction}</li>
                    ))}
                </ol>
                {view.task.scenario.think_aloud_cues.length ? (
                  <div className="rounded-lg bg-secondary/60 p-3 text-sm">
                    <p className="font-medium">Think aloud</p>
                    <ul className="mt-1 list-disc space-y-1 pl-4">
                      {view.task.scenario.think_aloud_cues.map((cue) => (
                        <li key={cue}>{cue}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-[15px] leading-snug">{view.task.participantPrompt}</p>
            )}
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Timer className="size-3.5" /> About {minutes} min · think out loud · not finishing is
              fine
            </p>
            <Button className="mt-4 w-full rounded-full" onClick={() => setStep("consent")}>
              Continue
            </Button>
          </>
        ) : null}

        {step === "consent" ? (
          <ConsentBody view={view} api={api} onAgreed={() => setStep("device_check")} />
        ) : null}

        {step === "device_check" ? (
          <>
            {!providersReady ? (
              <p className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
                Recording is not available: the media provider is not configured. Nothing is
                simulated.
              </p>
            ) : !audioOnly && rec.screenSupported === false ? (
              <p className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
                This browser cannot share its screen. Use a recent Chrome, Edge, Firefox or Safari.
              </p>
            ) : audioOnly ? (
              <div className="text-[13px]">
                <p className="text-muted-foreground">
                  We transcribe what you say while you do the task. Think out loud.
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <span className="flex-1">
                    {rec.status === "idle" ? (
                      <span className="text-muted-foreground">Microphone off</span>
                    ) : (
                      <MicMeter level={rec.micLevel} heard={rec.micHeard} />
                    )}
                  </span>
                  <Button
                    size="sm"
                    className="w-36 rounded-full"
                    disabled={rec.status === "starting" || rec.status === "recording"}
                    onClick={() => void rec.startAudioOnly()}
                  >
                    {rec.status === "starting" ? "Connecting…" : "Allow and start"}
                  </Button>
                </div>
              </div>
            ) : (
              <ol className="space-y-2 text-[13px]">
                <li className="flex items-center gap-2">
                  <StepBadge n={1} done={rec.status !== "idle"} />
                  <span className="flex-1 text-muted-foreground">
                    {rec.status === "idle" ? (
                      "Microphone, so your voice is transcribed"
                    ) : (
                      <MicMeter level={rec.micLevel} heard={rec.micHeard} />
                    )}
                  </span>
                  <Button
                    size="sm"
                    className="rounded-full"
                    disabled={rec.status !== "idle"}
                    onClick={() => void rec.requestMic()}
                  >
                    {rec.status === "idle" ? "Allow" : "Allowed"}
                  </Button>
                </li>
                <li className="flex items-center gap-2">
                  <StepBadge n={2} done={rec.status === "recording"} />
                  <span className="flex-1 text-muted-foreground">Screen: pick this app's tab</span>
                  <Button
                    size="sm"
                    className="w-32 rounded-full"
                    disabled={rec.status !== "mic_ready"}
                    onClick={() => void rec.startWithScreen()}
                  >
                    {rec.status === "starting" ? "Connecting…" : "Share and start"}
                  </Button>
                </li>
              </ol>
            )}
            {rec.error ? (
              <p className="mt-2 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {rec.error}
              </p>
            ) : null}
            <div className="mt-3 flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full"
                onClick={() => void finish("withdraw")}
              >
                Withdraw
              </Button>
            </div>
          </>
        ) : null}

        {step === "outcome" ? (
          <OutcomeBody api={api} assignmentId={assignmentId} onDone={() => setStep("done")} />
        ) : null}

        {step === "done" ? (
          <p className="text-[13px] text-muted-foreground">
            Your recording is uploading. Participation credit is recorded however the task went.
          </p>
        ) : null}
        {step === "withdrawn" ? (
          <p className="text-[13px] text-muted-foreground">Nothing more is captured.</p>
        ) : null}
        {step === "incomplete" ? (
          <>
            <p className="text-[13px] text-muted-foreground">
              The recording failed and is stored as incomplete, never as a finished session.
            </p>
            {rec.error ? (
              <p className="mt-2 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {rec.error}
              </p>
            ) : null}
          </>
        ) : null}
      </Frame>
    </div>
  );
}

/* ---------------- Pieces ---------------- */

const STEPS: Step[] = ["task", "consent", "device_check", "recording", "outcome", "done"];

function Frame({
  title,
  body,
  step,
  onClose,
  children,
}: {
  title: string;
  body?: string;
  step?: Step;
  onClose?: () => void;
  children?: React.ReactNode;
}) {
  const idx = step ? STEPS.indexOf(step) : -1;
  return (
    <section className="w-[404px] max-w-[100vw] p-5 text-foreground" aria-label={title}>
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-tight text-muted-foreground">
          <LogoMark className="size-3.5 text-brand" /> VibeCheck
        </span>
        <div className="flex items-center gap-2">
          {idx >= 0 ? (
            <span className="flex items-center gap-1" aria-hidden>
              {STEPS.map((s, i) => (
                <span
                  key={s}
                  className={`size-1.5 rounded-full ${i <= idx ? "bg-foreground" : "bg-border"}`}
                />
              ))}
            </span>
          ) : null}
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
      </div>
      <h2 className="mt-3 text-[17px] font-semibold tracking-tight">{title}</h2>
      {body ? <p className="mt-1 text-[13px] text-muted-foreground">{body}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function ConsentBody({
  view,
  api,
  onAgreed,
}: {
  view: AssignmentView;
  api: Api;
  onAgreed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cp = view.assignment.capturePolicy;
  const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);
  const rows = [
    {
      icon: Monitor,
      label: "Screen",
      value:
        cp.screen === "off"
          ? "Off, actions are logged instead"
          : `${cap(cp.screen)}, you pick the tab`,
    },
    { icon: Mic, label: "Microphone", value: `${cap(cp.microphone)}, transcribed` },
    { icon: cp.webcam === "off" ? CameraOff : Camera, label: "Webcam", value: cap(cp.webcam) },
    {
      icon: MousePointerClick,
      label: "Clicks, scroll",
      value: cp.pointer === "on" ? "In this app only" : "Off",
    },
    {
      icon: Keyboard,
      label: "Keyboard",
      value: cp.keyboard === "semantic_only" ? "Tab, Enter, Esc. Never text" : "Off",
    },
    { icon: Timer, label: "Kept for", value: `${cp.retention_days} days, then deleted` },
    { icon: Hand, label: "You control", value: "Pause, stuck, finish, withdraw" },
  ];
  return (
    <>
      <ul className="divide-y divide-border/70 rounded-xl border border-border/70 text-[13px]">
        {rows.map(({ icon: Icon, label, value }) => (
          <li key={label} className="flex items-center gap-2.5 px-3 py-1.5">
            <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
            <span className="min-w-0 leading-snug">{value}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        Continuing means you agree to this recording. You can pause or withdraw at any time.
      </p>
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      <Button
        className="mt-3 w-full rounded-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.post(`/api/assignments/${view.assignment.id}/consent`, {
              consent_version: CONSENT_VERSION,
            });
            onAgreed();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not record consent");
          } finally {
            setBusy(false);
          }
        }}
      >
        Agree and continue
      </Button>
    </>
  );
}

function RecordingPanel(props: {
  prompt: string;
  paused: boolean;
  sessionMs: () => number;
  instrumented: boolean;
  error: string | null;
  onPause: () => void;
  onResume: () => void;
  onStuck: () => void;
  onDone: () => void;
  onEarly: () => void;
  onWithdraw: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setElapsed(props.sessionMs()), 500);
    return () => clearInterval(t);
  }, [props.sessionMs]);
  return (
    <section
      className="w-[404px] max-w-[100vw] p-3.5 text-foreground"
      aria-label="Recording controls"
    >
      <div className="flex items-center gap-2">
        {props.paused ? (
          <span className="inline-block size-2.5 rounded-full bg-warning" />
        ) : (
          <span className="recording-dot" />
        )}
        <span className="text-[13px] font-medium">{props.paused ? "Paused" : "Recording"}</span>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">{fmt(elapsed)}</span>
      </div>
      <p className="mt-2.5 text-[15px] leading-snug text-foreground">{props.prompt}</p>
      {props.error ? <p className="mt-2 text-xs text-destructive">{props.error}</p> : null}
      <div className="mt-3 flex items-center gap-1.5">
        <IconButton
          label={props.paused ? "Resume" : "Pause"}
          onClick={props.paused ? props.onResume : props.onPause}
        >
          {props.paused ? <Play className="size-4" /> : <Pause className="size-4" />}
        </IconButton>
        <IconButton label="I'm stuck" onClick={props.onStuck} disabled={props.paused}>
          <Hand className="size-4" />
        </IconButton>
        <Button size="sm" className="ml-auto rounded-full px-4" onClick={props.onDone}>
          <Check className="size-4" /> Done
        </Button>
        <IconButton label="More" onClick={() => setMore((m) => !m)}>
          <span className="text-base leading-none">…</span>
        </IconButton>
      </div>
      {more ? (
        <div className="mt-2 flex gap-2 border-t border-border/70 pt-2 text-xs">
          <button
            type="button"
            className="rounded-full px-3 py-1 hover:bg-secondary"
            onClick={props.onEarly}
          >
            Finish early
          </button>
          <button
            type="button"
            className="rounded-full px-3 py-1 text-destructive hover:bg-destructive/10"
            onClick={props.onWithdraw}
          >
            Withdraw
          </button>
          {!props.instrumented ? (
            <span className="ml-auto self-center text-muted-foreground">video only</span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

const BAR_LEVELS = ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8"] as const;

function MicMeter({ level, heard }: { level: number; heard: boolean }) {
  const bars = BAR_LEVELS.length;
  const lit = Math.min(bars, Math.round(Math.sqrt(Math.min(1, level)) * bars));
  return (
    <span className="flex items-center gap-2">
      <span className="flex items-end gap-0.5" aria-hidden>
        {BAR_LEVELS.map((level, i) => (
          <span
            key={level}
            className={`w-1 rounded-sm transition-colors ${i < lit ? "bg-success" : "bg-border"}`}
            style={{ height: `${6 + i * 1.5}px` }}
          />
        ))}
      </span>
      <span className={heard ? "text-success" : "text-muted-foreground"}>
        {heard ? "We can hear you" : "Say something to test the mic"}
      </span>
    </span>
  );
}

function StepBadge({ n, done }: { n: number; done: boolean }) {
  return (
    <span
      className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${done ? "bg-success/15 text-success" : "bg-secondary text-muted-foreground"}`}
    >
      {done ? <Check className="size-3" /> : n}
    </span>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-8 items-center justify-center rounded-full border border-border/80 text-foreground transition-colors hover:bg-secondary disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function OutcomeBody({
  api,
  assignmentId,
  onDone,
}: {
  api: Api;
  assignmentId: string;
  onDone: () => void;
}) {
  const [reported, setReported] = useState<"completed" | "stuck" | "gave_up" | null>(null);
  const [difficulty, setDifficulty] = useState<number | null>(null);
  const [comments, setComments] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <p className="text-xs font-medium">Did you accomplish the task?</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {(["completed", "stuck", "gave_up"] as const).map((v) => (
          <Chip key={v} active={reported === v} onClick={() => setReported(v)}>
            {v === "completed" ? "Yes" : v === "stuck" ? "I got stuck" : "I gave up"}
          </Chip>
        ))}
      </div>
      <p className="mt-3 text-xs font-medium">
        How difficult was it?{" "}
        <span className="font-normal text-muted-foreground">1 easy · 5 hard</span>
      </p>
      <div className="mt-1.5 flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <Chip key={n} active={difficulty === n} onClick={() => setDifficulty(n)}>
            {n}
          </Chip>
        ))}
      </div>
      <Textarea
        className="mt-3 min-h-16 text-[13px]"
        rows={2}
        value={comments}
        onChange={(e) => setComments(e.target.value)}
        placeholder="What were you looking for? (optional)"
      />
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      <Button
        className="mt-3 w-full rounded-full"
        disabled={!reported || !difficulty || busy}
        onClick={async () => {
          if (!reported || !difficulty) return;
          setBusy(true);
          try {
            await api.post(`/api/assignments/${assignmentId}/outcome`, {
              participant_reported: reported,
              perceived_difficulty: difficulty,
              comments: comments.trim() || null,
            });
            onDone();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not submit");
          } finally {
            setBusy(false);
          }
        }}
      >
        Submit
      </Button>
    </>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-[13px] font-medium transition-colors ${active ? "border-foreground bg-foreground text-background" : "border-border hover:bg-secondary"}`}
    >
      {children}
    </button>
  );
}

function fmt(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
