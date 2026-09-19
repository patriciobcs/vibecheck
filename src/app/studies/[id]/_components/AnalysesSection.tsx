"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AnalysisRun } from "@/db/schema";
import { AutoRefresh } from "@/app/products/[id]/AutoRefresh";

export function AnalysesSection({ studyId, runs }: { studyId: string; runs: AnalysisRun[] }) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState("sample_session_capture_ideas");
  const [provider, setProvider] = useState("fixture");
  const [error, setError] = useState("");
  const active = runs.some((run) => run.status === "queued" || run.status === "analysing");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const response = await fetch(`/api/studies/${studyId}/analyses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, provider }),
    });
    if (!response.ok) {
      setError("Could not start analysis.");
      return;
    }
    router.refresh();
  }
  return (
    <section>
      <AutoRefresh active={active} />
      <h2>Analyses</h2>
      <form onSubmit={submit}>
        <label>
          Session ID
          <input value={sessionId} onChange={(event) => setSessionId(event.target.value)} />
        </label>
        <label>
          Provider
          <select value={provider} onChange={(event) => setProvider(event.target.value)}>
            <option value="fixture">fixture</option>
            <option value="devin">devin</option>
          </select>
        </label>
        <button type="submit">Analyse session</button>
      </form>
      {error && <p className="error">{error}</p>}
      {runs.map((run) => (
        <article key={run.id}>
          <strong>{run.sessionId}</strong> · {run.status}
          {run.outcome && ` · ${run.outcome}`}
          {run.error && ` · ${run.error}`}
          {run.providerSessionUrl && (
            <a href={run.providerSessionUrl} target="_blank" rel="noreferrer">
              Provider session
            </a>
          )}
        </article>
      ))}
    </section>
  );
}
