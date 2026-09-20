import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { NavLink, SampleBadge, Shell } from "@/components/layout/shell";
import { Button } from "@/components/ui/button";
import { db, schema } from "@/db/client";
import { currentMonitoringPolicy } from "@/domain/monitoring/policy";
import { parseGithubRepository } from "@/domain/onboarding";
import { productOverview } from "@/domain/overview";
import { ownerContext, ownerProduct, productDiscovery } from "@/domain/owner-products";
import { createDiscoveryRun } from "@/domain/products";
import { setProductRepoBinding } from "@/domain/repo-binding";
import { ApiError } from "@/lib/api";
import { env } from "@/lib/env";
import { productPath, withSearchParams } from "@/lib/product-path";
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

const words = (s: string) => s.replace(/_/g, " ");
const ago = (date: Date) => {
  const s = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
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
  const product = await ownerProduct(ctx.tenantIds, productId);
  redirect(productPath(product ?? { id: productId, slug: null }));
}

async function connectRepository(formData: FormData) {
  "use server";
  const ctx = await ownerContext();
  const productId = String(formData.get("productId") ?? "");
  if (!ctx) redirect(`/sign-in?next=/products/${productId}`);
  let errorMessage: string | null = null;
  try {
    const repository = parseGithubRepository(String(formData.get("repository") ?? ""));
    if (!repository)
      throw new ApiError(
        422,
        "repo_not_found",
        "Enter a repository as owner/repo or a github.com URL.",
      );
    const baseline = String(formData.get("baseline_commit") ?? "").trim();
    await setProductRepoBinding(ctx.writableTenantIds, productId, {
      provider: "github",
      ...repository,
      ...(baseline ? { baseline_commit_sha: baseline } : {}),
      issues_enabled: true,
    });
  } catch (error) {
    errorMessage =
      error instanceof ApiError
        ? error.message
        : "We couldn't connect that repository. Please try again.";
  }
  const product = await ownerProduct(ctx.tenantIds, productId);
  const path = productPath(product ?? { id: productId, slug: null });
  redirect(errorMessage ? `${path}?repo_error=${encodeURIComponent(errorMessage)}` : path);
}

export default async function ProductPage({ params, searchParams }: PageProps<"/products/[id]">) {
  const ctx = await ownerContext();
  const { id } = await params;
  const query = await searchParams;
  const repoError = typeof query.repo_error === "string" ? query.repo_error : null;
  if (!ctx) redirect(`/sign-in?next=/products/${id}`);
  const product = await ownerProduct(ctx.tenantIds, id);
  if (!product) notFound();
  if (product.slug !== id)
    permanentRedirect(withSearchParams(productPath(product), await searchParams));
  const runs = await productDiscovery(product.id);
  const overview = await productOverview(ctx.tenantIds, product.id);
  const { policy } = await currentMonitoringPolicy(product.id);
  const lastSession = await db.query.observationSessions.findFirst({
    where: eq(schema.observationSessions.productId, product.id),
    orderBy: desc(schema.observationSessions.createdAt),
    columns: { createdAt: true, lastEventAt: true },
  });
  const lastSdkActivity = lastSession ? (lastSession.lastEventAt ?? lastSession.createdAt) : null;
  const sources = new Map(
    [...product.releaseNotes, ...product.supportComplaints].map((s) => [s.id, s]),
  );
  const active = runs.some((r) => r.status === "queued" || r.status === "inspecting");
  const devinReady = env().devin !== null;
  const repo = overview?.product.repo_binding ?? null;
  const baseline = overview?.product.baseline_sha;
  const showBaseline = baseline !== null && baseline !== undefined && !/^0+$/.test(baseline);
  const imported = [...product.releaseNotes, ...product.supportComplaints];

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
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <Chip
              ok={policy.enabled}
              label={policy.enabled ? "Passive monitoring on" : "Passive monitoring off"}
            />
            <Chip
              ok={repo !== null}
              label={
                repo
                  ? `Repository connected: ${repo.kind === "github" ? repo.repo : repo.path}`
                  : "Repository not connected"
              }
            />
            {product.status === "needs_setup" ? <Chip ok={false} label="Needs setup" /> : null}
          </div>
          {product.status === "needs_setup" ? (
            <p className="mt-3 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
              Needs setup: {product.setupError ?? "check the product URL"}. URL-only research still
              works; repair modes stay disabled.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild className="rounded-full px-5">
            <Link href={productPath(product, "/monitoring/live")}>Live analysis</Link>
          </Button>
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
            <Button type="submit" variant="outline" className="rounded-full px-5" disabled={active}>
              {active ? "Discovery running…" : "Run discovery"}
            </Button>
          </form>
        </div>
      </div>

      <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          {overview ? <OverviewSection overview={overview} product={product} /> : null}

          <section className="space-y-4">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              What to test next
            </h2>
            {runs.length === 0 ? (
              <div className="surface p-8 text-center text-sm text-muted-foreground">
                No proposals yet. Discovery reads the release notes and complaints on the right and
                proposes neutral tasks for real participants.
              </div>
            ) : null}
            {runs.map((run) => (
              <article key={run.id} className="surface p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">
                      Discovery · {run.provider === "fixture" ? "sample proposals" : "Devin"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(run.createdAt).toLocaleString()} · outcome{" "}
                      {words(run.outcome ?? "pending")}
                      {run.outcomeReason ? ` · ${run.outcomeReason}` : ""}
                      {run.error ? ` · error: ${run.error}` : ""}
                      {run.correctionAttempts ? ` · ${run.correctionAttempts} correction` : ""}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${run.status === "proposed" ? "bg-success/15 text-success" : run.status === "failed" ? "bg-destructive/10 text-destructive" : "bg-secondary"}`}
                  >
                    {RUN_STATUS[run.status] ?? words(run.status)}
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
                          <p className="mt-1 text-[11px] text-muted-foreground">
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
                                  href={productPath(
                                    product,
                                    `/publish?run=${run.id}&task=${encodeURIComponent(p.taskId)}`,
                                  )}
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
                    The agent returned no useful proposal ({words(run.outcome ?? "proposed")}). No
                    downstream work was created.
                  </p>
                ) : null}
              </article>
            ))}
          </section>

          {overview ? (
            <CandidatesPanel
              candidates={overview.latest_candidates}
              monitoringHref={productPath(product, "/monitoring")}
            />
          ) : null}
        </div>
        <aside className="space-y-4">
          <div className="surface p-5 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Setup
            </p>
            <dl className="mt-3 grid grid-cols-[110px_1fr] gap-y-1.5 text-xs">
              <dt className="text-muted-foreground">Embed</dt>
              <dd>{product.embedMode === "sdk" ? "SDK script" : "hosted dialog"}</dd>
              <dt className="text-muted-foreground">Origins</dt>
              <dd>{product.permittedOrigins.join(", ") || "—"}</dd>
              <dt className="text-muted-foreground">Passive monitoring</dt>
              <dd>
                {policy.enabled ? "on" : "off"} ·{" "}
                <Link
                  href={productPath(product, "/monitoring")}
                  className="text-brand hover:underline"
                >
                  Settings
                </Link>
              </dd>
              <dt className="text-muted-foreground">Repository</dt>
              <dd>
                {repo ? (
                  <>
                    {repo.kind === "github" ? repo.repo : repo.path}
                    {showBaseline ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · baseline {baseline?.slice(0, 7)}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="text-muted-foreground">
                    not connected — connect a GitHub repository to enable draft PRs
                  </span>
                )}
                {overview?.product.setup_error ? (
                  <p className="mt-1 text-destructive">{overview.product.setup_error}</p>
                ) : null}
                {repoError ? <p className="mt-1 text-destructive">{repoError}</p> : null}
                <details className="mt-2">
                  <summary className="cursor-pointer text-brand hover:underline">
                    {repo?.kind === "github" ? "Change" : "Connect repository"}
                  </summary>
                  <form action={connectRepository} className="mt-2 space-y-2">
                    <input type="hidden" name="productId" value={product.id} />
                    <label className="block font-medium" htmlFor="repository">
                      GitHub repository
                    </label>
                    <input
                      id="repository"
                      name="repository"
                      defaultValue={repo?.kind === "github" ? repo.repo : ""}
                      placeholder="owner/repo"
                      className="h-8 w-full rounded-md border border-border bg-card px-2 text-xs"
                      required
                    />
                    <label className="block font-medium" htmlFor="baseline_commit">
                      Baseline commit
                    </label>
                    <input
                      id="baseline_commit"
                      name="baseline_commit"
                      defaultValue={repo?.kind === "github" ? (repo.baseline_commit_sha ?? "") : ""}
                      placeholder="Defaults to the default branch head"
                      className="h-8 w-full rounded-md border border-border bg-card px-2 font-mono text-xs"
                    />
                    <Button type="submit" size="sm" className="rounded-full">
                      Connect repository
                    </Button>
                  </form>
                </details>
              </dd>
              <dt className="text-muted-foreground">Last SDK activity</dt>
              <dd>{lastSdkActivity ? ago(lastSdkActivity) : "No SDK activity yet"}</dd>
            </dl>
          </div>
          <div className="surface p-5 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              About
            </p>
            <p className="mt-2">{product.description || "No description"}</p>
            <dl className="mt-3 grid grid-cols-[100px_1fr] gap-y-1 text-xs">
              <dt className="text-muted-foreground">Audience</dt>
              <dd>{product.audience || "—"}</dd>
              <dt className="text-muted-foreground">Language</dt>
              <dd>{product.language}</dd>
              <dt className="text-muted-foreground">Journeys</dt>
              <dd>{product.knownJourneys.join(", ") || "—"}</dd>
            </dl>
          </div>
          <div className="surface p-5 text-sm">
            <details>
              <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Release notes &amp; complaints
              </summary>
              <ul className="mt-2 space-y-1.5 text-xs">
                {imported.map((s) => (
                  <li key={s.id}>
                    {s.text}
                    {s.isSample ? (
                      <span className="ml-1 text-muted-foreground">(sample)</span>
                    ) : null}
                  </li>
                ))}
                {imported.length === 0 ? (
                  <li className="text-muted-foreground">None. Proposals will be exploratory.</li>
                ) : null}
              </ul>
            </details>
          </div>
        </aside>
      </section>
    </Shell>
  );
}

/** Status chip styled like the live board's status dots. */
function Chip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-border/70 px-2.5 py-1 font-medium ${ok ? "text-success" : "text-muted-foreground"}`}
    >
      <span className={`size-1.5 rounded-full ${ok ? "bg-success" : "bg-border"}`} />
      {label}
    </span>
  );
}
