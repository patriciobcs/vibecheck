"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ExperimentSummary } from "@/contracts/experimentSummary";

export function SummarySection({
  studyId,
  summary,
  revisions,
  findingTitles,
}: {
  studyId: string;
  summary: ExperimentSummary | null;
  revisions: Array<{ revision: number; status: string; generated_at: string }>;
  findingTitles: Record<string, string>;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  if (!summary) {
    return (
      <section>
        <h2>Experiment summary</h2>
        <p className="muted">No summary yet.</p>
        <button
          type="button"
          onClick={async () => {
            setLoading(true);
            await fetch(`/api/studies/${studyId}/summary`, { method: "POST" });
            setLoading(false);
            router.refresh();
          }}
        >
          {loading ? "Requesting…" : "Generate summary"}
        </button>
      </section>
    );
  }
  const sample = summary.provenance !== "human_session";
  return (
    <section>
      <h2>Experiment summary</h2>
      <p>
        <strong>{summary.narrative.headline || "Summary is collecting evidence"}</strong>{" "}
        {sample && <small>sample data — not human evidence</small>}
      </p>
      <p>
        Participation:{" "}
        {summary.participation.unknown
          ? "unknown"
          : `${summary.participation.invited} invited → ${summary.participation.accepted} accepted → ${summary.participation.started} started → ${summary.participation.completed} completed; ${summary.participation.dismissed} dismissed · ${summary.participation.abandoned} abandoned`}
      </p>
      <p>
        Sessions: {summary.sessions.eligible} eligible · {summary.sessions.outcomes.completed}{" "}
        completed · {summary.sessions.outcomes.stuck} stuck · {summary.sessions.outcomes.gave_up}{" "}
        gave up · {summary.sessions.outcomes.withdrew} withdrew
      </p>
      <table>
        <thead>
          <tr>
            <th>Theme</th>
            <th>Observed</th>
            <th>Certainty</th>
            <th>Issue</th>
            <th>Repair</th>
          </tr>
        </thead>
        <tbody>
          {summary.themes.map((theme) => (
            <tr key={theme.finding_id}>
              <td>
                {theme.title}
                <br />
                <small>{theme.category}</small>
              </td>
              <td>
                {theme.observed_session_count}/{theme.eligible_session_count}
              </td>
              <td>{theme.certainty.replaceAll("_", " ")}</td>
              <td>
                {theme.issue_ref ? (
                  <a href={theme.issue_ref.url}>Issue #{theme.issue_ref.number}</a>
                ) : (
                  "—"
                )}
              </td>
              <td>{theme.repair_status?.replaceAll("_", " ") ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Observations</h3>
      <ul>
        {summary.narrative.observations.map((observation, index) => (
          <li key={`${index}-${observation.text}`}>
            {observation.text}{" "}
            <small>
              ({observation.finding_ids.map((id) => findingTitles[id] ?? id).join(", ")})
            </small>
          </li>
        ))}
      </ul>
      {summary.narrative.limitations.length > 0 && (
        <>
          <h3>Limitations</h3>
          <ul>
            {summary.narrative.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </>
      )}
      <button
        type="button"
        onClick={async () => {
          setLoading(true);
          await fetch(`/api/studies/${studyId}/summary`, { method: "POST" });
          setLoading(false);
          router.refresh();
        }}
      >
        {loading ? "Requesting…" : "Regenerate"}
      </button>
      {revisions.length > 1 && <p>Revisions: {revisions.map((row) => row.revision).join(", ")}</p>}
    </section>
  );
}
