import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { NavLink, SampleBadge, Shell } from "@/components/layout/shell";
import { Button } from "@/components/ui/button";
import { productOverview } from "@/domain/overview";
import { ownerContext, ownerProduct, productDiscovery } from "@/domain/owner-products";
import { createDiscoveryRun } from "@/domain/products";
import { env } from "@/lib/env";
import { AutoRefresh } from "./auto-refresh";
import { OverviewSection } from "./overview-section";
import { CandidatesPanel } from "./signals-panel";

export const dynamic = "force-dynamic";

const RUN_STATUS: Record<string, string> = {
  queued: "Queued",
  inspecting: "Inspecting",
  proposed: "Proposed",
  failed: "Failed",
  cancelled: "Cancelled",
};

async function runDiscovery(formData: FormData) {
  "use server";
  const ctx = await ownerContext();
  if (!ctx) throw new Error("sign in required");
  const productId = String(formData.get("productId"));
  const provider = formData.get("provider") === "devin" ? "devin" : "fixture";
  if (provider === "devin" && !env().devin) throw new Error("DEVIN_API_KEY is not configured");
  for (const tenantId of ctx.writableTenantIds) {
    const run = await createDiscoveryRun(tenantId, productId, provider);
    if (run) break;
  }
  redirect(`/products/${productId}`);
}

export default async function ProductPage({ params }: PageProps<"/products/[id]">) {
  const ctx = await ownerContext();
  const { id } = await params;
  if (!ctx) redirect(`/sign-in?next=/products/${id}`);
  const product = await ownerProduct(ctx.tenantIds, id);
  if (!product) notFound();
  const runs = await productDiscovery(product.id);
  const overview = await productOverview(ctx.tenantIds, product.id);
  const sources = new Map(
    [...product.releaseNotes, ...product.supportComplaints].map((s) => [s.id, s]),
  );
  const active = runs.some((r) => r.status === "queued" || r.status === "inspecting");
  const devinReady = env().devin !== null;

  return (
    <Shell
      wide
      nav={
        <>
          <NavLink href="/products">Products</NavLink>
          <NavLink href="/owner">Sessions</NavLink>
          <NavLink href="/operations">Operations</NavLink>
          <span className="px-3 text-foreground">{ctx.email}</span>
        </>
      }
    >
      <AutoRefresh active={active} />
      {overview ? <OverviewSection overview={overview} /> : null}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
        <div>
          <Link href="/products" className="text-xs text-muted-foreground hover:text-foreground">
            ← Products
          </Link>
          <div className="mt-2 flex items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">{product.name}</h1>
            {product.sample ? <SampleBadge /> : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{product.url}</p>
          {product.status === "needs_setup" ? (
            <p className="mt-3 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
              Needs setup: {product.setupError ?? "check the product URL"}. URL-only research still
              works; repair modes stay disabled.
            </p>
          ) : null}
        </div>
        <form action={runDiscovery} className="flex items-center gap-2">
          <input type="hidden" name="productId" value={product.id} />
          <select
            name="provider"
            defaultValue={devinReady ? "devin" : "fixture"}
            className="h-9 rounded-full border border-border bg-card px-3 text-sm"
          >
            <option value="fixture">Sample proposals (no agent)</option>
            <option value="devin" disabled={!devinReady}>
              Devin {devinReady ? "" : "(not configured)"}
            </option>
          </select>
          <Button type="submit" className="rounded-full px-5" disabled={active}>
            {active ? "Discovery running…" : "Run discovery"}
          </Button>
        </form>
      </div>

      <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          {runs.length === 0 ? (
            <div className="surface p-8 text-center text-sm text-muted-foreground">
              No discovery runs yet. Run one to get proposed tasks.
            </div>
          ) : null}
          {runs.map((run) => (
            <article key={run.id} className="surface p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    Run {run.id.slice(-8)} ·{" "}
                    {run.provider === "fixture" ? "sample proposals" : "Devin"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(run.createdAt).toLocaleString()} · outcome {run.outcome ?? "pending"}
                    {run.outcomeReason ? ` · ${run.outcomeReason}` : ""}
                    {run.error ? ` · error: ${run.error}` : ""}
                    {run.correctionAttempts ? ` · ${run.correctionAttempts} correction` : ""}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${run.status === "proposed" ? "bg-success/15 text-success" : run.status === "failed" ? "bg-destructive/10 text-destructive" : "bg-secondary"}`}
                >
                  {RUN_STATUS[run.status] ?? run.status}
                </span>
              </div>
              {run.providerSessionUrl ? (
                <a
                  href={run.providerSessionUrl}
                  className="mt-2 inline-block text-xs text-brand underline-offset-4 hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  Provider session
                </a>
              ) : null}
              {run.proposals.length > 0 ? (
                <ul className="mt-5 grid gap-3">
                  {run.proposals.map((p) => {
                    const refs = p.evidenceRefs.map((r) => sources.get(r));
                    const sample = refs.some((s) => s?.isSample);
                    const unverified = refs.some((s) => !s);
                    return (
                      <li key={p.id} className="rounded-xl border border-border/70 p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{p.researchQuestion}</p>
                          {sample ? <SampleBadge /> : null}
                          {unverified ? (
                            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px]">
                              Unverified ref
                            </span>
                          ) : null}
                          {p.sourceCandidateRefs.length ? (
                            <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] text-brand">
                              From Jev passive candidate
                            </span>
                          ) : null}
                        </div>
                        <blockquote className="mt-2 text-sm">{p.participantPrompt}</blockquote>
                        {p.scenario ? (
                          <div className="mt-3 rounded-lg bg-secondary/60 p-3 text-sm">
                            <p className="font-medium">Participant scenario</p>
                            <p className="mt-1">{p.scenario.intro}</p>
                            <ol className="mt-2 list-decimal space-y-1 pl-5">
                              {p.scenario.steps
                                .slice()
                                .sort((a, b) => a.order - b.order)
                                .map((step) => (
                                  <li key={step.order}>{step.instruction}</li>
                                ))}
                            </ol>
                            {p.scenario.think_aloud_cues.length ? (
                              <div className="mt-2">
                                <p className="font-medium">Think aloud</p>
                                <ul className="mt-1 list-disc space-y-1 pl-4">
                                  {p.scenario.think_aloud_cues.map((cue) => (
                                    <li key={cue}>{cue}</li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                            <p className="mt-2 text-xs text-muted-foreground">
                              Estimated time: {p.scenario.estimated_minutes} minutes
                            </p>
                          </div>
                        ) : null}
                        <p className="mt-2 text-xs text-muted-foreground">{p.rationale}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Evidence: {p.evidenceRefs.join(", ") || "none"} ({p.evidenceType}) ·
                          eligibility {p.eligibilityRuleRef} · success {p.successRuleRef}
                        </p>
                        {p.uncertainties.length ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {p.uncertainties.join(" ")}
                          </p>
                        ) : null}
                        <div className="mt-3 flex items-center gap-2">
                          {p.publishedStudyIds.length ? (
                            <Button asChild size="sm" variant="outline" className="rounded-full">
                              <Link href={`/studies/${p.publishedStudyIds[0]}`}>
                                Published study
                              </Link>
                            </Button>
                          ) : (
                            <Button asChild size="sm" className="rounded-full">
                              <Link
                                href={`/products/${product.id}/publish?run=${run.id}&task=${encodeURIComponent(p.taskId)}`}
                              >
                                Publish study
                              </Link>
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : run.status === "proposed" ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  The agent returned no useful proposal ({run.outcome}). No downstream work was
                  created.
                </p>
              ) : null}
            </article>
          ))}
          {overview ? (
            <CandidatesPanel candidates={overview.latest_candidates} productId={product.id} />
          ) : null}
        </div>
        <aside className="space-y-4">
          <div className="surface p-5 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Context
            </p>
            <p className="mt-2">{product.description || "No description"}</p>
            <dl className="mt-3 grid grid-cols-[100px_1fr] gap-y-1 text-xs">
              <dt className="text-muted-foreground">Audience</dt>
              <dd>{product.audience || "—"}</dd>
              <dt className="text-muted-foreground">Language</dt>
              <dd>{product.language}</dd>
              <dt className="text-muted-foreground">Origins</dt>
              <dd>{product.permittedOrigins.join(", ") || "—"}</dd>
              <dt className="text-muted-foreground">Journeys</dt>
              <dd>{product.knownJourneys.join(", ") || "—"}</dd>
            </dl>
          </div>
          <div className="surface p-5 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Imported material
            </p>
            <ul className="mt-2 space-y-1.5 text-xs">
              {[...product.releaseNotes, ...product.supportComplaints].map((s) => (
                <li key={s.id} className="flex gap-2">
                  <span className="shrink-0 font-mono text-muted-foreground">{s.id}</span>
                  <span className="min-w-0">
                    {s.text}
                    {s.isSample ? (
                      <span className="ml-1 text-muted-foreground">(sample)</span>
                    ) : null}
                  </span>
                </li>
              ))}
              {product.releaseNotes.length + product.supportComplaints.length === 0 ? (
                <li className="text-muted-foreground">None. Proposals will be exploratory.</li>
              ) : null}
            </ul>
          </div>
        </aside>
      </section>
    </Shell>
  );
}
