type Candidate = {
  id: string;
  category: string;
  target_ref: string;
  distinct_observation_sessions: number;
  state: string;
  created_at: string;
};

/** Passive candidates are corroboration hints, not findings, human evidence, issues or repairs. */
export function CandidatesPanel({
  candidates,
  productId,
}: {
  candidates: Candidate[];
  productId: string;
}) {
  return (
    <section className="surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Jev passive signal — not human evidence
        </p>
        <a
          href={`/products/${productId}/monitoring`}
          className="text-xs text-brand hover:underline"
        >
          Monitoring
        </a>
      </div>
      {candidates.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No research candidates yet.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {candidates.map((candidate) => (
            <li key={candidate.id} className="rounded-xl border border-border/70 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{candidate.category}</p>
                <span className="font-mono text-xs text-muted-foreground">
                  {candidate.target_ref}
                </span>
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px]">
                  {candidate.state}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {candidate.distinct_observation_sessions} distinct observation sessions ·{" "}
                {new Date(candidate.created_at).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
