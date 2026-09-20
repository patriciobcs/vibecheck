"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type FormState = { error?: string; values?: Record<string, string> };

export function ProductForm({
  action,
  workspaces,
}: {
  action: (state: FormState, data: FormData) => Promise<FormState>;
  workspaces: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const values = state.values ?? {};
  return (
    <form action={formAction} className="surface mt-8 space-y-5 p-6">
      {workspaces.length > 1 ? (
        <div className="space-y-1.5">
          <Label htmlFor="tenant_id">Workspace</Label>
          <select
            id="tenant_id"
            name="tenant_id"
            required
            defaultValue={values.tenant_id ?? ""}
            className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm"
          >
            <option value="" disabled>
              Choose a workspace
            </option>
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <Field
        label="Project name"
        name="name"
        required
        placeholder="Acme Booking"
        defaultValue={values.name}
      />
      <Field
        label="App URL"
        name="url"
        type="url"
        required
        placeholder="https://app.example.com"
        hint="Link to the app you want people to try, such as a live site or deployed preview."
        defaultValue={values.url}
      />
      <details
        className="rounded-xl border border-border/70 p-4"
        open={state.error ? true : undefined}
      >
        <summary className="cursor-pointer text-sm font-medium">
          Add context or adjust settings (optional)
        </summary>
        <div className="mt-5 space-y-5">
          <Area
            label="Description"
            name="description"
            rows={2}
            placeholder="What does your product do, and who is it for?"
            defaultValue={values.description}
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Audience"
              name="audience"
              placeholder="Salon customers"
              defaultValue={values.audience}
            />
            <Field label="Language" name="language" defaultValue={values.language ?? "en"} />
          </div>
          <Field
            label="Permitted origins"
            name="origins"
            placeholder="https://app.example.com, https://staging.example.com"
            hint="Defaults to your app's origin. Override with a comma-separated list if needed."
            defaultValue={values.origins}
          />
          <Field
            label="GitHub repository"
            name="repository"
            placeholder="owner/repo"
            hint="Optional. Needed only for GitHub issues and code changes. Accepts owner/repo or a github.com URL."
            defaultValue={values.repository}
          />
          <Field
            label="Baseline commit"
            name="baseline_commit"
            placeholder="Defaults to the head of the default branch"
            className="font-mono"
            defaultValue={values.baseline_commit}
          />
          <Area
            label="Release notes"
            name="release_notes"
            rows={3}
            placeholder="One per line"
            defaultValue={values.release_notes}
          />
          <Area
            label="Support complaints"
            name="complaints"
            rows={3}
            placeholder="One per line"
            defaultValue={values.complaints}
          />
          <Area
            label="Known journeys"
            name="journeys"
            rows={2}
            placeholder="One per line, e.g. reschedule an appointment"
            defaultValue={values.journeys}
          />
          <div className="flex items-center gap-2 text-sm">
            <Checkbox id="sample" name="sample" defaultChecked={values.sample === "on"} />
            <Label htmlFor="sample" className="font-normal">
              Mark imported items as sample data
            </Label>
          </div>
        </div>
      </details>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" className="w-full rounded-full px-6 sm:w-auto" disabled={pending}>
        {pending ? "Adding project…" : "Add project"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Next: run discovery and choose a study. A repository is only needed for GitHub issues and
        code changes; you can add it later from the project page.
      </p>
    </form>
  );
}

function Field({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & React.ComponentProps<typeof Input>) {
  const hintId = hint ? `${props.name}-hint` : undefined;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={props.name}>{label}</Label>
      <Input id={props.name} aria-describedby={hintId} {...props} />
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function Area({ label, ...props }: { label: string } & React.ComponentProps<typeof Textarea>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={props.name}>{label}</Label>
      <Textarea id={props.name} {...props} />
    </div>
  );
}
