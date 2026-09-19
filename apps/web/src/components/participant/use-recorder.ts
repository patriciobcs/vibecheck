"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Api } from "./api";

type Status = "idle" | "mic_ready" | "starting" | "recording" | "failed";

type StartResponse = {
  session_id: string;
  media: { provider: "vonage"; application_id: string; session_id: string; token: string };
  events_token: string;
};

type OT = typeof import("@vonage/client-sdk-video");
type Publisher = ReturnType<OT["initPublisher"]>;

export type SessionInfo = { sessionId: string; clockOriginMs: number; eventsToken: string };

let otModule: Promise<OT> | null = null;
function loadOT(): Promise<OT> {
  otModule ??= import("@vonage/client-sdk-video").then(
    (m) => ((m as unknown as { default?: OT }).default ?? m) as OT,
  );
  return otModule;
}

function friendly(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  if (/NotAllowed|permission|denied/i.test(message))
    return "Permission was not granted. Try again or withdraw.";
  if (/InvalidState/i.test(message))
    return "The browser lost the click. Press the button again and choose a screen right away.";
  if (/media_unavailable/.test(message))
    return "Could not restart the recording. Try resuming again.";
  return message;
}

/**
 * Browser side of recording. Two user gestures on purpose: browsers (Safari strictly) only allow
 * screen capture while a click is still "active", so the screen request is the first thing that
 * happens in its click handler and the microphone prompt gets its own click.
 */
export function useRecorder(opts: {
  api: Api;
  assignmentId: string;
  onSession: (s: SessionInfo) => void;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [screenSupported, setScreenSupported] = useState<boolean | null>(null);
  /** 0..1 from the provider's audioLevelUpdated; lets the tester see they are being heard. */
  const [micLevel, setMicLevel] = useState(0);
  const [micHeard, setMicHeard] = useState(false);
  const sessionRef = useRef<ReturnType<OT["initSession"]> | null>(null);
  const micRef = useRef<Publisher | null>(null);
  const screenRef = useRef<Publisher | null>(null);
  const startRef = useRef<StartResponse | null>(null);
  const clockOriginRef = useRef<number | null>(null);
  const markerSeq = useRef(0);
  const markerBatch = useRef(0);
  const { api, assignmentId, onSession } = opts;

  // Preload the client SDK and the capability check so the click handlers stay synchronous.
  useEffect(() => {
    loadOT()
      .then((OT) => OT.checkScreenSharingCapability((r) => setScreenSupported(r.supported)))
      .catch((e) => setError(friendly(e)));
  }, []);

  const sessionMs = useCallback(
    () => (clockOriginRef.current ? Math.max(0, Date.now() - clockOriginRef.current) : 0),
    [],
  );

  const marker = useCallback(
    async (label: "pause" | "resume" | "stuck" | "finished_early" | "withdraw") => {
      const start = startRef.current;
      if (!start) return;
      await api
        .post(`/api/assignments/${assignmentId}/events`, {
          session_id: start.session_id,
          batch_sequence: 100_000 + markerBatch.current++,
          events: [
            {
              session_id: start.session_id,
              sequence: 1_000_000 + markerSeq.current++,
              t_ms: sessionMs(),
              type: "task_marker",
              label,
            },
          ],
        })
        .catch(() => {});
    },
    [api, assignmentId, sessionMs],
  );

  const teardown = useCallback(() => {
    for (const p of [micRef.current, screenRef.current]) {
      try {
        p?.destroy();
      } catch {}
    }
    micRef.current = null;
    screenRef.current = null;
    try {
      void sessionRef.current?.disconnect();
    } catch {}
    sessionRef.current = null;
  }, []);

  /** Click 1: microphone permission. */
  const requestMic = useCallback(async () => {
    setError(null);
    try {
      const OT = await loadOT();
      micRef.current = await OT.initPublisher.promise(undefined, {
        videoSource: null,
        publishVideo: false,
        insertDefaultUI: false,
      });
      micRef.current.on("audioLevelUpdated", (event) => {
        const level = event.audioLevel;
        setMicLevel(level);
        if (level > 0.04) setMicHeard(true);
      });
      setStatus("mic_ready");
    } catch (e) {
      setError(friendly(e));
    }
  }, []);

  /** Click 2: screen picker first (while the click is still active), then the server-side archive. */
  const startWithScreen = useCallback(async () => {
    setError(null);
    const OT = await loadOT(); // already resolved: no real await, activation survives
    const holder: { pub: Publisher | null } = { pub: null };
    try {
      await new Promise<void>((resolve, reject) => {
        // Called synchronously inside the click so the browser still has the user activation.
        holder.pub = OT.initPublisher(
          undefined,
          {
            videoSource: "screen",
            publishAudio: false,
            insertDefaultUI: false,
            maxResolution: { width: 1920, height: 1080 },
          },
          (err) => (err ? reject(new Error(err.name || err.message)) : resolve()),
        );
      });
    } catch (e) {
      setError(friendly(e));
      return;
    }
    const screen = holder.pub;
    if (!screen) return;
    screenRef.current = screen;
    setStatus("starting");
    try {
      const clockOrigin = Date.now();
      clockOriginRef.current = clockOrigin;
      const resp = await api.post<StartResponse>(
        `/api/assignments/${assignmentId}/recording/start`,
        { instrumentation: "sdk", client_clock_origin_ms: clockOrigin },
      );
      startRef.current = resp;
      const session = OT.initSession(resp.media.application_id, resp.media.session_id);
      sessionRef.current = session;
      await new Promise<void>((resolve, reject) =>
        session.connect(resp.media.token, (err) =>
          err ? reject(new Error(err.message)) : resolve(),
        ),
      );
      for (const p of [micRef.current, screen]) {
        if (!p) continue;
        await new Promise<void>((resolve, reject) =>
          session.publish(p, (err) => (err ? reject(new Error(err.message)) : resolve())),
        );
      }
      // Vonage only records sessions with a connected client, so the archive starts after publishing.
      await api.post(`/api/assignments/${assignmentId}/recording/archive`, {
        t_ms: Math.max(0, Date.now() - clockOrigin),
      });
      screen.on("mediaStopped", () =>
        setError("Screen sharing stopped. Finish or withdraw to end the session."),
      );
      setStatus("recording");
      onSession({
        sessionId: resp.session_id,
        clockOriginMs: clockOrigin,
        eventsToken: resp.events_token,
      });
    } catch (e) {
      setError(friendly(e));
      teardown();
      setStatus("failed");
    }
  }, [api, assignmentId, onSession, teardown]);

  /** Audio-only studies (capture policy screen: off): one click after the microphone is allowed. */
  const startAudioOnly = useCallback(async () => {
    setError(null);
    const OT = await loadOT();
    setStatus("starting");
    try {
      const clockOrigin = Date.now();
      clockOriginRef.current = clockOrigin;
      const resp = await api.post<StartResponse>(
        `/api/assignments/${assignmentId}/recording/start`,
        { instrumentation: "sdk", client_clock_origin_ms: clockOrigin },
      );
      startRef.current = resp;
      const session = OT.initSession(resp.media.application_id, resp.media.session_id);
      sessionRef.current = session;
      await new Promise<void>((resolve, reject) =>
        session.connect(resp.media.token, (err) =>
          err ? reject(new Error(err.message)) : resolve(),
        ),
      );
      const mic = micRef.current;
      if (!mic) throw new Error("Microphone is not ready");
      await new Promise<void>((resolve, reject) =>
        session.publish(mic, (err) => (err ? reject(new Error(err.message)) : resolve())),
      );
      await api.post(`/api/assignments/${assignmentId}/recording/archive`, {
        t_ms: Math.max(0, Date.now() - clockOrigin),
      });
      setStatus("recording");
      onSession({
        sessionId: resp.session_id,
        clockOriginMs: clockOrigin,
        eventsToken: resp.events_token,
      });
    } catch (e) {
      setError(friendly(e));
      teardown();
      setStatus("failed");
    }
  }, [api, assignmentId, onSession, teardown]);

  const pausedRef = useRef(false);
  const busyRef = useRef(false);

  const pause = useCallback(async () => {
    if (pausedRef.current || busyRef.current) return;
    busyRef.current = true;
    try {
      await api.post(`/api/assignments/${assignmentId}/recording/pause`, { t_ms: sessionMs() });
      micRef.current?.publishAudio(false);
      screenRef.current?.publishVideo(false);
      pausedRef.current = true;
      setPaused(true);
      setError(null);
      await marker("pause");
    } catch (e) {
      setError(friendly(e));
    } finally {
      busyRef.current = false;
    }
  }, [api, assignmentId, sessionMs, marker]);

  const resume = useCallback(async () => {
    if (!pausedRef.current || busyRef.current) return;
    busyRef.current = true;
    // Streams must be live before the provider will start a new archive.
    micRef.current?.publishAudio(true);
    screenRef.current?.publishVideo(true);
    try {
      await api.post(`/api/assignments/${assignmentId}/recording/resume`, { t_ms: sessionMs() });
      pausedRef.current = false;
      setPaused(false);
      setError(null);
      await marker("resume");
    } catch (e) {
      micRef.current?.publishAudio(false);
      screenRef.current?.publishVideo(false);
      setError(friendly(e));
    } finally {
      busyRef.current = false;
    }
  }, [api, assignmentId, sessionMs, marker]);

  const markStuck = useCallback(() => marker("stuck"), [marker]);

  const finish = useCallback(
    async (reason: "finished" | "finished_early" | "stuck" | "withdraw") => {
      if (reason === "finished_early" || reason === "withdraw") await marker(reason);
      await api.post(`/api/assignments/${assignmentId}/recording/finish`, {
        t_ms: sessionMs(),
        reason,
      });
      teardown();
    },
    [api, assignmentId, sessionMs, marker, teardown],
  );

  useEffect(() => () => teardown(), [teardown]);

  return {
    status,
    error,
    paused,
    screenSupported,
    micLevel,
    micHeard,
    requestMic,
    startWithScreen,
    startAudioOnly,
    pause,
    resume,
    markStuck,
    finish,
    sessionMs,
  };
}
