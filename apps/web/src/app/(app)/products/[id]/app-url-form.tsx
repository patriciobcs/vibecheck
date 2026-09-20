"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type AppUrlState = { error?: string; url?: string };

export function AppUrlForm({
  productId,
  action,
}: {
  productId: string;
  action: (state: AppUrlState, data: FormData) => Promise<AppUrlState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="surface mb-8 space-y-3 p-6">
      <h2 className="font-medium">Ready to research your app?</h2>
      <p id="app-url-help" className="text-sm text-muted-foreground">
        Add the deployed site or preview that participants will use. Your GitHub repository
        identifies the code; this URL identifies the running app.
      </p>
      <input type="hidden" name="productId" value={productId} />
      <Label htmlFor="app-url">Live app URL</Label>
      <Input
        id="app-url"
        name="url"
        type="url"
        required
        aria-describedby="app-url-help"
        placeholder="https://app.example.com"
        defaultValue={state.url}
      />
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="rounded-full">
        {pending ? "Saving…" : "Save app URL"}
      </Button>
    </form>
  );
}
