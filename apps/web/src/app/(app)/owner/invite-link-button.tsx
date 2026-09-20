"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function InviteLinkButton({ studyId }: { studyId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    const res = await fetch(`/api/owner/studies/${studyId}/invitations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expires_in_days: 14 }),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error("Could not create an invitation link.");
      return;
    }
    const body = (await res.json()) as { url: string };
    setUrl(body.url);
  }

  return (
    <>
      <Button size="sm" variant="outline" className="rounded-full" onClick={create} disabled={busy}>
        {busy ? "Creating…" : "New direct link"}
      </Button>
      <Dialog open={url !== null} onOpenChange={(o) => !o && setUrl(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share this link</DialogTitle>
            <DialogDescription>
              Valid for 14 days. Each participant signs in and consents before anything is recorded.
              The token is not a credential.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={url ?? ""} onFocus={(e) => e.currentTarget.select()} />
            <Button
              onClick={async () => {
                if (url) await navigator.clipboard.writeText(url);
                toast.success("Copied");
              }}
            >
              Copy
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
