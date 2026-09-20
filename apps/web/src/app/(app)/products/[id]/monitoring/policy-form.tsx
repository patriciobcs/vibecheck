"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Policy = {
  enabled: boolean;
  allowed_journeys: string[];
  window_ms: number;
  cooldown_ms: number;
  batch_delay_ms: number;
  normal_journey_sample_rate: number;
  max_evaluations_per_session_hour: number;
  max_evaluations_per_product_day: number;
  daily_spend_cap_usd: number;
  candidate_friction_threshold: number;
  candidate_research_threshold: number;
  raw_event_retention_days: number;
  derived_retention_days: number;
};

export function PolicyForm({ productId, policy }: { productId: string; policy: Policy }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string) => Number(f.get(k));
    setBusy(true);
    const res = await fetch(`/api/owner/products/${productId}/monitoring`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: f.get("enabled") === "on",
        allowed_journeys: String(f.get("allowed_journeys") ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        window_ms: num("window_ms"),
        cooldown_ms: num("cooldown_ms"),
        batch_delay_ms: num("batch_delay_ms"),
        normal_journey_sample_rate: num("normal_journey_sample_rate"),
        max_evaluations_per_session_hour: num("max_evaluations_per_session_hour"),
        max_evaluations_per_product_day: num("max_evaluations_per_product_day"),
        daily_spend_cap_usd: num("daily_spend_cap_usd"),
        candidate_friction_threshold: num("candidate_friction_threshold"),
        candidate_research_threshold: num("candidate_research_threshold"),
        raw_event_retention_days: num("raw_event_retention_days"),
        derived_retention_days: num("derived_retention_days"),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error("Could not save policy");
      return;
    }
    toast.success("Policy saved as a new revision");
    router.refresh();
  }
  const F = ({ k, label, step }: { k: keyof Policy; label: string; step?: string }) => (
    <div className="space-y-1">
      <Label htmlFor={k} className="text-xs">
        {label}
      </Label>
      <Input
        id={k}
        name={k}
        type="number"
        step={step ?? "1"}
        defaultValue={String(policy[k])}
        className="h-8 text-xs"
      />
    </div>
  );
  return (
    <form onSubmit={submit} className="mt-3 space-y-3 text-xs">
      <label className="flex items-center gap-2">
        <input type="checkbox" name="enabled" defaultChecked={policy.enabled} /> Passive collection
        enabled
      </label>
      <div className="space-y-1">
        <Label htmlFor="allowed_journeys" className="text-xs">
          Allowed journeys (comma separated)
        </Label>
        <Input
          id="allowed_journeys"
          name="allowed_journeys"
          defaultValue={policy.allowed_journeys.join(", ")}
          className="h-8 text-xs"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <F k="batch_delay_ms" label="Batch delay (ms)" />
        <F k="window_ms" label="Window (ms)" />
        <F k="cooldown_ms" label="Cooldown (ms)" />
        <F k="normal_journey_sample_rate" label="Normal sample rate" step="0.001" />
        <F k="max_evaluations_per_session_hour" label="Max per session/hour" />
        <F k="max_evaluations_per_product_day" label="Max per product/day" />
        <F k="daily_spend_cap_usd" label="Daily spend cap (USD)" step="0.01" />
        <F k="candidate_friction_threshold" label="Friction threshold" step="0.01" />
        <F k="candidate_research_threshold" label="Research threshold" step="0.01" />
        <F k="raw_event_retention_days" label="Raw retention (days)" />
        <F k="derived_retention_days" label="Derived retention (days)" />
      </div>
      <Button type="submit" size="sm" className="rounded-full" disabled={busy}>
        Save policy
      </Button>
    </form>
  );
}
