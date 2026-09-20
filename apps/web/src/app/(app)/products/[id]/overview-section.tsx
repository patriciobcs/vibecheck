import Link from "next/link";
import type { productOverview } from "@/domain/overview";

type Overview = NonNullable<Awaited<ReturnType<typeof productOverview>>>;

const STATE_STYLE: Record<string, string> = {
  done: "bg-success/15 text-success",
  active: "bg-brand/10 text-brand",
  waiting: "bg-secondary text-muted-foreground",
  skipped: "bg-secondary/50 text-muted-foreground line-through",
  blocked: "bg-destructive/10 text-destructive",
};

export function OverviewSection({ overview }: { overview: Overview }) {
  const { product } = overview;
  return (
    <section className="mb-8 space-y-4">
      {overview.paused ? (
        <p className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          Tenant paused — new external work is waiting. Resume on the{" "}
          <Link href="/operations" className="underline">
            Operations page
          </Link>
          .
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="surface p-5 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Repository
          </p>
          <p className="mt-2 font-medium">
            {product.repo_binding?.kind === "github"
              ? product.repo_binding.repo
              : (product.repo_binding?.path ?? "Not connected")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {product.connection.kind === "github" && !product.connection.writesEnabled
              ? "Repository link saved. GitHub access is not verified; issues and code changes are off."
              : `${product.connection.kind}: ${product.connection.healthy ? "credentials configured" : "needs attention"}`}
          </p>
          {product.baseline_sha ? (
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              baseline {product.baseline_sha.slice(0, 10)}
            </p>
          ) : null}
        </div>
        <div className="surface p-5 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Findings
          </p>
          <p className="mt-2 font-medium">
            {overview.findings_needing_attention} needing attention
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{overview.open_issues} open issues</p>
        </div>
        <div className="surface p-5 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Passive candidates
          </p>
          <p className="mt-2 font-medium">
            {Object.values(overview.candidates_by_state).reduce((sum, count) => sum + count, 0)}{" "}
            candidates
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {overview.candidates_by_state.proposed} proposed ·{" "}
            {overview.candidates_by_state.accepted} accepted ·{" "}
            {overview.candidates_by_state.study_linked} linked
          </p>
        </div>
        <div className="surface p-5 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Studies
          </p>
          <p className="mt-2 font-medium">{overview.studies.length}</p>
        </div>
      </div>
      {overview.studies.map((study) => (
        <div key={study.id} className="surface p-5">
          <div className="flex items-center gap-2 text-sm">
            <Link href={`/studies/${study.id}`} className="font-medium hover:underline">
              Study {study.id.slice(-8)}
            </Link>
            <span className="text-xs text-muted-foreground">
              {study.status}
              {study.mode ? ` · ${study.mode}` : ""}
            </span>
          </div>
          <ol className="mt-3 flex flex-wrap gap-1.5">
            {study.stages.map((stage) => (
              <li
                key={stage.key}
                title={stage.waitingReason}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATE_STYLE[stage.state] ?? "bg-secondary"}`}
              >
                {stage.label}
                {stage.count !== undefined ? ` ${stage.count}` : ""}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}
