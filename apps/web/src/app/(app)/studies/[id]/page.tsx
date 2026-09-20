import { and, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { InviteLinkButton } from "@/app/(app)/owner/invite-link-button";
import { AutoRefresh } from "@/app/(app)/products/[id]/auto-refresh";
import { NavLink, SampleBadge, Shell } from "@/components/layout/shell";
import { db, schema } from "@/db/client";
import { ownerContext } from "@/domain/owner-products";
import { RepairSection } from "./_components/RepairSection";

export const dynamic = "force-dynamic";

export default async function StudyPage({ params }: PageProps<"/studies/[id]">) {
  const ctx = await ownerContext();
  const { id } = await params;
  if (!ctx) redirect(`/sign-in?next=/studies/${id}`);
  const study = ctx.tenantIds.length
    ? await db.query.studies.findFirst({
        where: and(eq(schema.studies.id, id), inArray(schema.studies.tenantId, ctx.tenantIds)),
      })
    : null;
  if (!study) notFound();
  const revision = await db.query.studyRevisions.findFirst({
    where: and(
      eq(schema.studyRevisions.studyId, study.id),
      eq(schema.studyRevisions.revision, study.currentRevision),
    ),
  });
  const event = await db.query.eventOutbox.findFirst({
    where: eq(
      schema.eventOutbox.idempotencyKey,
      `${study.id}:revision_${study.currentRevision}:publish`,
    ),
  });
  const product = await db.query.products.findFirst({
    where: eq(schema.products.id, study.productId),
  });
  const assignments = await db.$count(schema.assignments, eq(schema.assignments.studyId, study.id));
  const analyses = await db.query.analysisRuns.findMany({
    where: eq(schema.analysisRuns.studyId, study.id),
    orderBy: schema.analysisRuns.createdAt,
  });
  const findings = await db.query.findings.findMany({
    where: eq(schema.findings.studyId, study.id),
    orderBy: schema.findings.createdAt,
  });
  const repairs = await db.query.repairRuns.findMany({
    where: eq(schema.repairRuns.studyId, study.id),
    orderBy: schema.repairRuns.createdAt,
  });
  const checks = repairs.length
    ? await db.query.checkRuns.findMany({
        where: eq(schema.checkRuns.repairRunId, repairs[0]?.id ?? ""),
        orderBy: schema.checkRuns.createdAt,
      })
    : [];
  const previews = repairs.length
    ? await db.query.previews.findMany({
        where: eq(schema.previews.repairRunId, repairs[0]?.id ?? ""),
        orderBy: schema.previews.createdAt,
      })
    : [];
  const activeAnalysis = analyses.some(
    (run) => run.status === "queued" || run.status === "analysing",
  );

  return (
    <Shell
      wide
      nav={
        <>
          <NavLink href="/products">Products</NavLink>
          <NavLink href="/owner">Sessions</NavLink>
          <span className="px-3 text-foreground">{ctx.email}</span>
        </>
      }
    >
      <Link
        href={`/products/${study.productId}`}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        ← {product?.name ?? "Product"}
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Study</h1>
        <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium capitalize">
          {study.status}
        </span>
        {revision?.provenance === "sample" ? <SampleBadge /> : null}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Revision {study.currentRevision} · {assignments} assignment{assignments === 1 ? "" : "s"} ·{" "}
        <InviteLinkButton studyId={study.id} />
      </p>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="surface p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Immutable plan (handoff to VC-02)
          </p>
          <pre className="mt-3 overflow-x-auto rounded-xl bg-secondary/60 p-4 font-mono text-[11px] leading-relaxed">
            {JSON.stringify(revision?.plan, null, 2)}
          </pre>
        </section>
        <section className="surface p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            study.published event
          </p>
          <pre className="mt-3 overflow-x-auto rounded-xl bg-secondary/60 p-4 font-mono text-[11px] leading-relaxed">
            {JSON.stringify(event?.envelope ?? null, null, 2)}
          </pre>
          {revision?.sourceCandidateRefs.length ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Source candidates: {revision.sourceCandidateRefs.join(", ")}
            </p>
          ) : null}
        </section>
      </div>
      <AutoRefresh active={activeAnalysis} />
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="surface p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Analyses
          </p>
          {analyses.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No analyses yet.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {analyses.map((run) => (
                <article key={run.id} className="rounded-xl border p-3 text-sm">
                  <p className="font-medium">{run.sessionId}</p>
                  <p className="text-muted-foreground">
                    {run.status}
                    {run.outcome ? ` · ${run.outcome}` : ""}
                  </p>
                  {run.error ? <p className="text-destructive">{run.error}</p> : null}
                </article>
              ))}
            </div>
          )}
          <RepairSection
            repair={repairs[0] ?? null}
            checks={checks}
            preview={previews[0] ?? null}
          />
        </section>
        <section className="surface p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Findings
          </p>
          {findings.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No findings yet.</p>
          ) : (
            <div className="mt-3 space-y-4">
              {findings.map((finding) => (
                <article key={finding.id} className="rounded-xl border p-3">
                  <h2 className="font-medium">{finding.title}</h2>
                  <p className="text-xs text-muted-foreground">
                    {finding.category} · {finding.semanticTarget}
                  </p>
                  <p className="mt-2 text-sm">{finding.observation}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {finding.certainty} · {finding.observedSessionCount}/
                    {finding.eligibleSessionCount} sessions
                  </p>
                  {finding.provenance !== "human_session" ? (
                    <p className="mt-2 text-xs text-amber-700">
                      simulated/fixture — not human evidence
                    </p>
                  ) : null}
                  {finding.issueUrl ? (
                    <a className="mt-2 inline-block text-sm underline" href={finding.issueUrl}>
                      GitHub issue
                    </a>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </Shell>
  );
}
