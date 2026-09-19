import { readHandoffFragment } from "@vibecheck/contracts/embed";
import { EventRecorder } from "./recorder";

export type { EventBatch, RecordedEvent, RecorderOptions } from "./recorder";
export { EventRecorder } from "./recorder";

export type VibeCheckConfig = {
  /** Origin-bound publishable key; identifies the product and grants nothing else. */
  publishableKey: string;
  /** VibeCheck app origin, e.g. https://app.vibecheck.dev */
  apiOrigin: string;
  /** Delay before checking eligibility so the toast never interrupts page load. Default 4s. */
  invitationDelayMs?: number;
  /** Paths where an invitation must never appear (e.g. checkout). */
  quietPaths?: RegExp[];
};

type Offer = {
  studyId: string;
  productId: string;
  participantPrompt: string;
  estimatedSeconds: number;
  capture: { screen: string; microphone: string };
};

type DialogMode = "modal" | "panel" | "hidden";
type DialogMessage =
  | { type: "vibecheck:ui"; mode: DialogMode; height?: number }
  | { type: "vibecheck:session"; sessionId: string; clockOriginMs: number; eventsToken: string }
  | { type: "vibecheck:stop" }
  | { type: "vibecheck:close" };

const DISMISS_KEY = "vibecheck:dismissed_until";
const LOCAL_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

let recorder: EventRecorder | null = null;
let listenersAttached = false;

/* ---------------- Instrumentation (runs only while a session token is held) ---------------- */

let activeSessionId: string | null = null;

/** Listeners are attached once and always forward to the current recorder. */
function attachListeners() {
  if (listenersAttached) return;
  listenersAttached = true;
  const r = () => recorder;
  document.addEventListener("click", (e) => r()?.onClick(e), true);
  document.addEventListener("mousemove", (e) => r()?.onPointerMove(e), {
    capture: true,
    passive: true,
  });
  document.addEventListener("scroll", () => r()?.onScroll(), { capture: true, passive: true });
  document.addEventListener("keydown", (e) => r()?.onKeyDown(e), true);
  document.addEventListener("input", (e) => r()?.onInput(e), true);
  window.addEventListener("focus", () => r()?.onFocus(true));
  window.addEventListener("blur", () => r()?.onFocus(false));
  document.addEventListener("visibilitychange", () =>
    r()?.onVisibility(document.visibilityState === "visible"),
  );
  const origPush = history.pushState.bind(history);
  history.pushState = (...args) => {
    origPush(...args);
    r()?.onNavigation(location.href);
  };
  window.addEventListener("popstate", () => r()?.onNavigation(location.href));
  window.addEventListener("pagehide", () => void r()?.flush());
}

/**
 * Starts sending safe events for one session. Idempotent per session id: the dialog may repeat
 * the handshake, and repeating must not replace a recorder that already holds events.
 */
export function startInstrumentation(
  cfg: VibeCheckConfig,
  session: { sessionId: string; clockOriginMs: number; eventsToken: string },
) {
  if (recorder && activeSessionId === session.sessionId) return recorder;
  recorder?.stop();
  activeSessionId = session.sessionId;
  recorder = new EventRecorder({
    sessionId: session.sessionId,
    clockOriginMs: session.clockOriginMs,
    flushIntervalMs: 2000,
    send: async (batch) => {
      const res = await fetch(`${cfg.apiOrigin}/api/sdk/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.eventsToken}`,
          "X-VibeCheck-Key": cfg.publishableKey,
        },
        body: JSON.stringify(batch),
      });
      if (!res.ok) throw new Error(`events rejected: ${res.status}`);
    },
  });
  attachListeners();
  recorder.onNavigation(location.href);
  return recorder;
}

export function stopInstrumentation() {
  if (!recorder) return;
  void recorder.flush();
  recorder.stop();
  recorder = null;
  activeSessionId = null;
}

/* ---------------- Dialog overlay (iframe on the VibeCheck origin) ---------------- */

const OVERLAY_STYLE = `
.vc-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(17,17,20,.32);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);opacity:0;transition:opacity .25s ease}
.vc-overlay.vc-in{opacity:1}
.vc-overlay iframe{border:0;width:404px;max-width:calc(100vw - 16px);height:320px;max-height:calc(100vh - 16px);background:#fff;border-radius:20px;box-shadow:0 1px 2px rgba(0,0,0,.05),0 16px 40px -16px rgba(0,0,0,.2);color-scheme:normal}
.vc-overlay.vc-panel{inset:auto 16px 16px auto;background:transparent;backdrop-filter:none;-webkit-backdrop-filter:none;pointer-events:none}
.vc-overlay.vc-panel iframe{pointer-events:auto;width:404px}
`;

let overlay: HTMLDivElement | null = null;
let dialogFrame: HTMLIFrameElement | null = null;

function openDialog(cfg: VibeCheckConfig, url: string) {
  closeDialog();
  const style = document.createElement("style");
  style.textContent = OVERLAY_STYLE;
  document.head.appendChild(style);
  overlay = document.createElement("div");
  overlay.className = "vc-overlay";
  dialogFrame = document.createElement("iframe");
  dialogFrame.src = url;
  dialogFrame.title = "VibeCheck";
  // Permission delegation so the dialog can request the microphone and screen from inside the frame.
  dialogFrame.setAttribute("allow", "microphone; display-capture; camera");
  overlay.appendChild(dialogFrame);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay?.classList.add("vc-in"));
  dialogFrame.addEventListener("load", () => {
    dialogFrame?.contentWindow?.postMessage(
      { type: "vibecheck:host", instrumented: true },
      cfg.apiOrigin,
    );
  });
}

function setDialogMode(mode: DialogMode, height?: number) {
  if (!overlay || !dialogFrame) return;
  if (mode === "hidden") return closeDialog();
  overlay.classList.toggle("vc-panel", mode === "panel");
  if (height) dialogFrame.style.height = `${Math.min(height, window.innerHeight - 16)}px`;
}

function closeDialog() {
  overlay?.remove();
  overlay = null;
  dialogFrame = null;
}

/**
 * Tell the dialog when the participant leaves this window (another tab or app) so it can
 * auto-pause, and when they come back. Focus moving into the dialog iframe is not "leaving".
 */
function watchHostFocus(cfg: VibeCheckConfig) {
  let focused = true;
  const report = (next: boolean) => {
    if (next === focused || !dialogFrame) return;
    focused = next;
    dialogFrame.contentWindow?.postMessage(
      { type: "vibecheck:host-focus", focused },
      cfg.apiOrigin,
    );
  };
  window.addEventListener("blur", () => {
    setTimeout(() => {
      if (document.activeElement === dialogFrame) return;
      if (!document.hasFocus()) report(false);
    }, 150);
  });
  window.addEventListener("focus", () => report(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") report(false);
    else if (document.hasFocus()) report(true);
  });
}

function listenToDialog(cfg: VibeCheckConfig) {
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.origin !== cfg.apiOrigin) return;
    if (!dialogFrame || event.source !== dialogFrame.contentWindow) return;
    const data = event.data as DialogMessage | null;
    if (!data || typeof data !== "object") return;
    switch (data.type) {
      case "vibecheck:ui":
        setDialogMode(data.mode, data.height);
        // The dialog may not have been listening when the load-time greeting was sent; re-greet.
        dialogFrame.contentWindow?.postMessage(
          { type: "vibecheck:host", instrumented: true },
          cfg.apiOrigin,
        );
        break;
      case "vibecheck:session":
        startInstrumentation(cfg, {
          sessionId: data.sessionId,
          clockOriginMs: data.clockOriginMs,
          eventsToken: data.eventsToken,
        });
        dialogFrame.contentWindow?.postMessage({ type: "vibecheck:instrumented" }, cfg.apiOrigin);
        break;
      case "vibecheck:stop":
        stopInstrumentation();
        break;
      case "vibecheck:close":
        stopInstrumentation();
        closeDialog();
        break;
    }
  });
}

/** Direct link / marketplace handoff: `#vc=<assignment token>` on the product URL. Never sent to a server. */
function consumeHandoff(cfg: VibeCheckConfig): boolean {
  const token = readHandoffFragment(location.hash);
  if (!token) return false;
  history.replaceState(null, "", location.pathname + location.search);
  openDialog(cfg, `${cfg.apiOrigin}/embed/a#vc=${encodeURIComponent(token)}`);
  return true;
}

/* ---------------- Hosted recorder handshake (products opened in a window by /a/[id]) ---------------- */

export function listenForRecorder(cfg: VibeCheckConfig) {
  if (!window.opener) return;
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.origin !== cfg.apiOrigin) return;
    const data = event.data as DialogMessage | null;
    if (!data || typeof data !== "object") return;
    if (data.type === "vibecheck:session") {
      startInstrumentation(cfg, {
        sessionId: data.sessionId,
        clockOriginMs: data.clockOriginMs,
        eventsToken: data.eventsToken,
      });
      (event.source as Window | null)?.postMessage(
        { type: "vibecheck:instrumented" },
        event.origin,
      );
    }
    if (data.type === "vibecheck:stop") stopInstrumentation();
  });
  window.opener.postMessage(
    { type: "vibecheck:ready", publishableKey: cfg.publishableKey },
    cfg.apiOrigin,
  );
}

/* ---------------- Invitation toast ---------------- */

function dismissedLocally(): boolean {
  try {
    return Number(localStorage.getItem(DISMISS_KEY) ?? 0) > Date.now();
  } catch {
    return false;
  }
}

function rememberDismissal() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + LOCAL_COOLDOWN_MS));
  } catch {}
}

async function fetchOffer(cfg: VibeCheckConfig): Promise<Offer | null> {
  try {
    const res = await fetch(`${cfg.apiOrigin}/api/sdk/eligibility`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-VibeCheck-Key": cfg.publishableKey },
      body: JSON.stringify({ publishable_key: cfg.publishableKey }),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { study: Offer | null }).study;
  } catch {
    return null;
  }
}

const TOAST_STYLE = `
.vc-toast{position:fixed;right:20px;bottom:20px;z-index:2147482999;max-width:340px;font:13px/1.45 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif;color:#1c1c1e;background:rgba(255,255,255,.94);backdrop-filter:saturate(180%) blur(16px);-webkit-backdrop-filter:saturate(180%) blur(16px);border:1px solid rgba(0,0,0,.08);border-radius:16px;box-shadow:0 1px 2px rgba(0,0,0,.05),0 18px 40px -18px rgba(0,0,0,.28);padding:14px 16px 12px;opacity:0;transform:translateY(8px);transition:opacity .3s ease,transform .3s ease}
.vc-toast.vc-in{opacity:1;transform:none}
.vc-toast h3{margin:0 0 4px;font-size:14px;font-weight:600;letter-spacing:-.01em}
.vc-toast p{margin:0 0 10px;color:#6e6e73}
.vc-toast .vc-actions{display:flex;gap:6px;justify-content:flex-end}
.vc-toast button{font:inherit;font-weight:600;border-radius:999px;padding:6px 12px;border:1px solid transparent;cursor:pointer}
.vc-toast .vc-accept{background:#1c1c1e;color:#fff}
.vc-toast .vc-dismiss{background:transparent;color:#1c1c1e;border-color:rgba(0,0,0,.12)}
`;

function showToast(cfg: VibeCheckConfig, offer: Offer) {
  if (document.querySelector(".vc-toast")) return;
  const style = document.createElement("style");
  style.textContent = TOAST_STYLE;
  document.head.appendChild(style);
  const minutes = Math.max(1, Math.round(offer.estimatedSeconds / 60));
  const el = document.createElement("div");
  el.className = "vc-toast";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Invitation to a short usability test");
  el.innerHTML = `
    <h3>Help improve this app?</h3>
    <p>One short task, about ${minutes} min, with your screen and voice recorded. Stop any time.</p>
    <div class="vc-actions"><button type="button" class="vc-dismiss">Not now</button><button type="button" class="vc-accept">See the task</button></div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("vc-in"));
  const close = () => {
    el.classList.remove("vc-in");
    setTimeout(() => el.remove(), 300);
  };
  el.querySelector(".vc-dismiss")?.addEventListener("click", () => {
    rememberDismissal();
    close();
    void fetch(`${cfg.apiOrigin}/api/sdk/dismiss`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-VibeCheck-Key": cfg.publishableKey },
      body: JSON.stringify({
        publishable_key: cfg.publishableKey,
        study_id: offer.studyId,
        product_id: offer.productId,
      }),
    }).catch(() => {});
  });
  el.querySelector(".vc-accept")?.addEventListener("click", () => {
    close();
    // The dialog (VibeCheck origin) shows the task and consent; nothing is recorded until then.
    openDialog(
      cfg,
      `${cfg.apiOrigin}/embed/join/${encodeURIComponent(offer.studyId)}?key=${encodeURIComponent(cfg.publishableKey)}`,
    );
  });
}

/** Entry point: handoff dialog, hosted-recorder handshake, or a polite invitation. */
export function init(cfg: VibeCheckConfig) {
  if (typeof window === "undefined") return;
  listenToDialog(cfg);
  watchHostFocus(cfg);
  listenForRecorder(cfg);
  if (consumeHandoff(cfg)) return;
  if (window.opener) return;
  if (dismissedLocally()) return;
  if (cfg.quietPaths?.some((re) => re.test(location.pathname))) return;
  window.setTimeout(async () => {
    const offer = await fetchOffer(cfg);
    if (offer) showToast(cfg, offer);
  }, cfg.invitationDelayMs ?? 4000);
}
