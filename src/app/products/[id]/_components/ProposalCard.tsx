import Link from "next/link";
import type { Proposal } from "@/db/schema";

type SourceItem = { id: string; isSample?: boolean };

export function ProposalCard({
  productId,
  proposal,
  sourceItems,
}: {
  productId: string;
  proposal: Proposal;
  sourceItems: SourceItem[];
}) {
  const refs = proposal.evidenceRefs.map((ref) => sourceItems.find((item) => item.id === ref));
  const sample = refs.some((item) => item?.isSample);
  const unverified = refs.some((item) => !item);

  return (
    <article className="card">
      <h3>{proposal.taskId}</h3>
      {sample && <span>Sample data</span>}
      {unverified && <span>Unverified ref</span>}
      <p>{proposal.participantPrompt}</p>
      <p>{proposal.researchQuestion}</p>
      <p>{proposal.rationale}</p>
      <p className="muted">
        Evidence: {proposal.evidenceRefs.join(", ")} ({proposal.evidenceType})
      </p>
      <p className="muted">
        Eligibility: {proposal.eligibilityRuleRef} · Success: {proposal.successRuleRef}
      </p>
      <p className="muted">{proposal.uncertainties.join(" ")}</p>
      <Link
        href={`/products/${productId}/publish?run=${proposal.discoveryRunId}&task=${proposal.taskId}`}
      >
        <button>Publish study</button>
      </Link>
    </article>
  );
}
