import type { CheckRunRow, Preview, RepairRun } from "@/db/schema";

export function RepairSection({
  repair,
  checks,
  preview,
}: {
  repair: RepairRun | null;
  checks: CheckRunRow[];
  preview: Preview | null;
}) {
  if (!repair) return null;
  return (
    <section>
      <h4>Repair</h4>
      <p>
        Status: {repair.status} · attempt {repair.attempt}/{repair.maxAttempts}
      </p>
      {repair.candidateCommitSha && <p>Candidate: {repair.candidateCommitSha.slice(0, 8)}</p>}
      {repair.blockedReason && <p>Blocked: {repair.blockedReason}</p>}
      {checks.length > 0 && (
        <ul>
          {checks.flatMap((check) =>
            check.results.map((result) => (
              <li key={`${check.id}-${result.id}`}>
                {result.name}: {result.status}
              </li>
            )),
          )}
        </ul>
      )}
      {repair.pullRequestUrl && (
        <p>
          <a href={repair.pullRequestUrl}>Draft pull request</a>
        </p>
      )}
      {preview?.url && (
        <p>
          <a href={preview.url}>Preview</a>
        </p>
      )}
    </section>
  );
}
