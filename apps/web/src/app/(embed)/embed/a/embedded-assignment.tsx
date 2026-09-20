"use client";

import { readHandoffFragment } from "@vibecheck/contracts/embed";
import { useEffect, useState } from "react";
import { ParticipantDialog } from "@/components/participant/dialog";

type State = { token: string; assignmentId: string } | { error: string } | null;

export function EmbeddedAssignment({ providersReady }: { providersReady: boolean }) {
  const [state, setState] = useState<State>(null);

  useEffect(() => {
    const token = readHandoffFragment(window.location.hash);
    if (!token) {
      setState({ error: "Missing handoff." });
      return;
    }
    fetch("/api/embed/assignment", { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (!res.ok) throw new Error("This link is no longer valid.");
        const body = (await res.json()) as { assignment_id: string };
        setState({ token, assignmentId: body.assignment_id });
      })
      .catch((e: Error) => setState({ error: e.message }));
  }, []);

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
