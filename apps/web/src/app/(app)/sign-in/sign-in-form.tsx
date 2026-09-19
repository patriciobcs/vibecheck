"use client";

import { useState } from "react";
import { authClient } from "@/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SignInForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setError(null);
    const res = await authClient.signIn.magicLink({ email, callbackURL: next });
    if (res.error) {
      setState("error");
      setError(res.error.message ?? "Could not send the link.");
      return;
    }
    setState("sent");
  }

  if (state === "sent") {
    return (
      <div className="space-y-2 text-sm">
        <p className="font-medium">Check your inbox</p>
        <p className="text-muted-foreground">
          We sent a sign-in link to <span className="text-foreground">{email}</span>. It expires in
          15 minutes.
        </p>
        <a
          href="/dev/inbox"
          className="inline-block pt-2 text-brand underline-offset-4 hover:underline"
        >
          Open the local test inbox
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" className="w-full rounded-full" disabled={state === "sending"}>
        {state === "sending" ? "Sending…" : "Send sign-in link"}
      </Button>
    </form>
  );
}
