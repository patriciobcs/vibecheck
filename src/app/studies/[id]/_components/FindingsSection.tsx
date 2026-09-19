import type { Finding } from "@/db/schema";

export function FindingsSection({ findings }: { findings: Finding[] }) {
  return (
    <section>
      <h2>Findings</h2>
      {findings.length === 0 && <p className="muted">No findings yet.</p>}
      <div className="grid">
        {findings.map((finding) => (
          <article key={finding.id}>
            <h3>
              {finding.category} · {finding.semanticTarget}
            </h3>
            <p>
              {finding.certainty} · {finding.observedSessionCount}/{finding.eligibleSessionCount}{" "}
              sessions · {finding.impact}
            </p>
            <p>{finding.observation}</p>
            <p>{finding.hypothesis}</p>
            <ul>
              {finding.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
            {finding.provenance !== "human_session" && (
              <small>simulated/fixture — not human evidence</small>
            )}
            {finding.issueUrl && (
              <p>
                <a href={finding.issueUrl}>GitHub issue</a>
              </p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
