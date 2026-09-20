import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { productOverview } from "@/domain/overview";
import { productPath } from "@/lib/product-path";

type Overview = NonNullable<Awaited<ReturnType<typeof productOverview>>>;
type ProductRef = { id: string; slug: string | null };

const STATE_STYLE: Record<string, string> = {
  done: "bg-success/15 text-success",
  active: "bg-brand/10 text-brand",
  waiting: "bg-secondary text-muted-foreground",
  skipped: "bg-secondary/50 text-muted-foreground line-through",
  blocked: "bg-destructive/10 text-destructive",
};

const MODE_LABEL: Record<string, string> = {
  issues_only: "Issues only",
  draft_pr: "Draft PR",
  prototype_and_retest: "Prototype and retest",
};

const words = (s: string) => s.replace(/_/g, " ");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Stat({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: number;
  hint: string;
  href?: string;
}) {
  const card = (
    <>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </>
  );
  return href ? (
    <Link
      href={href}
      className="surface block p-4 transition-shadow hover:shadow-[var(--shadow-float)]"
    >
      {card}
    </Link>
  ) : (
    <div className="surface p-4">{card}</div>
  );
}

/** The top of the product page: the four numbers, then one card per study. */
export function OverviewSection({
  overview,
  product,
}: {
  overview: Overview;
  product: ProductRef;
}) {
  const candidates = overview.candidates_by_state;
  const totalCandidates = Object.values(candidates).reduce((sum, count) => sum + count, 0);
  const sessions = overview.studies.reduce((sum, s) => sum + s.sessions, 0);
  const firstStudy = overview.studies[0];
  return (
    <section className="space-y-6">
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
        <Stat label="Sessions" value={sessions} hint="completed study sessions" href="/owner" />
        <Stat
          label="Passive signals"
          value={totalCandidates}
          hint={`${candidates.proposed} proposed · ${candidates.accepted} accepted · ${candidates.study_linked} linked`}
          href={productPath(product, "/monitoring")}
        />
        <Stat
          label="Findings"
          value={overview.findings_needing_attention}
          hint="needing attention"
          href={firstStudy ? `/studies/${firstStudy.id}` : undefined}
        />
        <Stat label="Open issues" value={overview.open_issues} hint="with a linked issue" />
      </div>
      <div className="space-y-4">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Studies
        </h2>
        {overview.studies.length === 0 ? (
          <div className="surface p-8 text-center text-sm text-muted-foreground">
            No studies yet. Publish a proposal below to recruit participants.
          </div>
        ) : null}
        {overview.studies.map((study) => (
          <article key={study.id} className="surface p-5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{study.title ?? "Untitled study"}</p>
              <span className="text-xs text-muted-foreground">
                {cap(words(study.status))}
                {study.mode ? ` · ${MODE_LABEL[study.mode] ?? words(study.mode)}` : ""}
              </span>
            </div>
            {study.task_prompt ? (
              <blockquote className="mt-2 border-l-2 border-border pl-3 text-sm text-muted-foreground">
                {study.task_prompt}
              </blockquote>
            ) : null}
            <p className="mt-2 text-xs text-muted-foreground">
              {study.sessions} session{study.sessions === 1 ? "" : "s"}
            </p>
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
            <div className="mt-4 flex items-center gap-2">
              <Button asChild size="sm" variant="outline" className="rounded-full">
                <Link href={`/studies/${study.id}`}>Open study</Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="rounded-full">
                <Link href={productPath(product, "/monitoring/live")}>Live analysis</Link>
              </Button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
