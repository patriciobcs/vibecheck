"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const MESSAGES: Record<string, string> = {
  invitation_exhausted: "This invitation has already been used.",
  study_full: "This study has all the participants it needs.",
  paused: "The owner has paused new sessions for now.",
  expired: "This invitation has expired.",
};

export function RedeemButton({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  async function redeem() {
    setBusy(true);
    const res = await fetch("/api/invitations/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const body = (await res.json()) as {
      assignment_id?: string;
      destination?: string;
      error?: string;
    };
    setBusy(false);
    if (!res.ok || !body.assignment_id) {
      toast.error(MESSAGES[body.error ?? ""] ?? "Could not start. Please try again.");
      return;
    }
    window.location.href = body.destination ?? `/a/${body.assignment_id}`;
  }
  return (
    <Button size="lg" className="rounded-full px-6" onClick={redeem} disabled={busy}>
      {busy ? "Preparing…" : "Continue"}
    </Button>
  );
}
