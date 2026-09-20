"use client";

import { useState } from "react";
import { authClient } from "@/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SignInForm({ next, localInbox }: { next: string; localInbox: boolean }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setError(null);
    try {
      const res = await authClient.signIn.magicLink({ email, callbackURL: next });
      if (res.error) {
        setState("error");
        setError(res.error.message ?? "Could not create the sign-in link.");
        return;
      }
      setState("sent");
    } catch {
      setState("error");
      setError("Could not create the sign-in link. Please try again.");
    }
  }

  if (state === "sent") {
    return (
      <div className="space-y-2 text-sm">
        <p className="font-medium">
          {localInbox ? "Your local sign-in link is ready" : "Check your inbox"}
        </p>
        <p className="text-muted-foreground">
          {localInbox ? "A test link is ready for " : "We sent a sign-in link to "}
          <span className="text-foreground">{email}</span>. It expires in 15 minutes.
        </p>
        {localInbox ? (
          <a
            href="/dev/inbox"
            className="inline-block pt-2 text-brand underline-offset-4 hover:underline"
          >
            Open the local test inbox
          </a>
        ) : null}
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
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full rounded-full" disabled={state === "sending"}>
        {state === "sending"
          ? "Creating link…"
          : localInbox
            ? "Create local sign-in link"
            : "Send sign-in link"}
      </Button>
    </form>
  );
}
