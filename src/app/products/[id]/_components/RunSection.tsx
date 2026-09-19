import type { DiscoveryRun, Proposal } from "@prisma/client";
import { ProposalCard } from "./ProposalCard";

type SourceItem = { id: string; isSample?: boolean };
type RunWithProposals = DiscoveryRun & { proposals: Proposal[] };

export function RunSection({
  run,
  productId,
  sourceItems,
}: {
  run: RunWithProposals;
  productId: string;
  sourceItems: SourceItem[];
}) {
  return (
    <section>
      <h2>
        Run {run.id.slice(-8)} · {run.status}
      </h2>
      <p className="muted">
        Outcome: {run.outcome ?? "pending"}
        {run.outcomeReason ? ` · ${run.outcomeReason}` : ""}
        {run.error ? ` · Error: ${run.error}` : ""}
      </p>
      {run.providerSessionUrl && (
        <p>
          <a href={run.providerSessionUrl}>Provider session</a>
        </p>
      )}
      <div className="grid">
        {run.proposals.map((proposal) => (
          <ProposalCard
            key={proposal.id}
            productId={productId}
            proposal={proposal}
            sourceItems={sourceItems}
          />
        ))}
      </div>
    </section>
  );
}
