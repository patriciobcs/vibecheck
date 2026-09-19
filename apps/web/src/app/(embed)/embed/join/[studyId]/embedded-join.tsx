"use client";

import { useEffect, useState } from "react";
import { ParticipantDialog } from "@/components/participant/dialog";

const DEVICE_KEY = "vibecheck:device";

type JoinState = { token: string; assignmentId: string } | { error: string };

// Module-level so React's development double-invoked effects share one claim (one device, one assignment).
let inflight: Promise<JoinState> | null = null;

async function deviceToken(): Promise<string> {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
  } catch {}
  const res = await fetch("/api/embed/device", { method: "POST" });
  const token = ((await res.json()) as { device_token: string }).device_token;
  try {
    localStorage.setItem(DEVICE_KEY, token);
  } catch {}
  return token;
}

async function join(studyId: string, publishableKey: string): Promise<JoinState> {
  const device = await deviceToken();
  const res = await fetch("/api/embed/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${device}` },
    body: JSON.stringify({ study_id: studyId, publishable_key: publishableKey }),
  });
  const body = (await res.json()) as {
    assignment_id?: string;
    assignment_token?: string;
    error?: string;
  };
  if (!res.ok || !body.assignment_id || !body.assignment_token) {
    const text: Record<string, string> = {
      study_full: "This study already has all the participants it needs.",
      paused: "The owner has paused new sessions.",
    };
    return { error: text[body.error ?? ""] ?? "Could not start this study." };
  }
  return { token: body.assignment_token, assignmentId: body.assignment_id };
}

export function EmbeddedJoin({
  studyId,
  publishableKey,
  providersReady,
}: {
  studyId: string;
  publishableKey: string;
  providersReady: boolean;
}) {
  const [state, setState] = useState<JoinState | null>(null);

  useEffect(() => {
    inflight ??= join(studyId, publishableKey).catch((e: Error) => ({ error: e.message }));
    let active = true;
    inflight.then((s) => active && setState(s));
    return () => {
      active = false;
    };
  }, [studyId, publishableKey]);

  if (!state) return <p className="p-4 text-sm text-muted-foreground">Preparing…</p>;
  if ("error" in state) return <p className="w-[404px] p-5 text-sm">{state.error}</p>;
  return (
    <ParticipantDialog
      assignmentId={state.assignmentId}
      token={state.token}
      host={{ kind: "iframe" }}
      providersReady={providersReady}
    />
  );
}
