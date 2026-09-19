"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function ClaimButton({
  studyId,
  disabled,
  signedIn,
  existingAssignmentId,
}: {
  studyId: string;
  disabled: boolean;
  signedIn: boolean;
  existingAssignmentId: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // A participant who already claimed this study continues their own assignment; no second claim.
  if (existingAssignmentId) {
    return (
      <Button asChild className="rounded-full">
        <Link href={`/a/${existingAssignmentId}`}>Continue your task</Link>
      </Button>
    );
  }

  async function claim() {
    if (!signedIn) {
      router.push(`/sign-in?next=${encodeURIComponent("/marketplace")}`);
      return;
    }
    setBusy(true);
    const res = await fetch("/api/marketplace/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ study_id: studyId }),
    });
    const body = (await res.json()) as {
      assignment_id?: string;
      destination?: string;
      error?: string;
    };
    setBusy(false);
    if (!res.ok || !body.assignment_id) {
      toast.error(
        body.error === "study_full"
          ? "Someone just took the last spot."
          : "Could not claim this study.",
      );
      router.refresh();
      return;
    }
    window.location.href = body.destination ?? `/a/${body.assignment_id}`;
  }
  return (
    <Button className="rounded-full" onClick={claim} disabled={disabled || busy}>
      {busy ? "Claiming…" : signedIn ? "Claim task" : "Sign in to claim"}
    </Button>
  );
}
