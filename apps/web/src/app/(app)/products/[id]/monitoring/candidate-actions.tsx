"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function CandidateActions({
  candidateId,
  state,
  devinReady,
}: {
  candidateId: string;
  state: string;
  devinReady: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function act(body: Record<string, unknown>, success: string) {
    setBusy(true);
    const res = await fetch(`/api/owner/candidates/${candidateId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error("Action failed");
      return;
    }
    toast.success(success);
    router.refresh();
  }
  if (state === "dismissed") return null;
  return (
    <>
      {state !== "study_linked" ? (
        <Button
          size="sm"
          className="rounded-full"
          disabled={busy}
          onClick={() =>
            void act(
              { action: "request_task_proposal", provider: devinReady ? "devin" : "fixture" },
              "Discovery run queued from this candidate",
            )
          }
        >
          Request task proposal
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        className="rounded-full"
        disabled={busy}
        onClick={() => {
          const reason = window.prompt("Why dismiss this candidate?");
          if (reason) void act({ action: "dismiss", reason }, "Candidate dismissed");
        }}
      >
        Dismiss
      </Button>
    </>
  );
}
