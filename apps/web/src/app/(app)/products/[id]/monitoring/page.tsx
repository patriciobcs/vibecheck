import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { NavLink, Shell } from "@/components/layout/shell";
import { monitoringOverview } from "@/domain/monitoring/overview";
import { ownerContext, ownerProduct } from "@/domain/owner-products";
import { CandidateActions } from "./candidate-actions";
import { PolicyForm } from "./policy-form";

export const dynamic = "force-dynamic";

const fmtCost = (micros: number | null) =>
  micros === null ? "unpriced" : `$${(micros / 1_000_000).toFixed(4)}`;

export default async function MonitoringPage({ params }: PageProps<"/products/[id]/monitoring">) {
  const ctx = await ownerContext();
  const { id } = await params;
  if (!ctx) redirect(`/sign-in?next=/products/${id}/monitoring`);
  const product = await ownerProduct(ctx.tenantIds, id);
  if (!product) notFound();
  const o = await monitoringOverview(product.id);
  const activeDetectors = o.detectors.filter((d) => d.status === "active");

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
      <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
        <div>
          <Link
            href={`/products/${product.id}`}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← {product.name}
          </Link>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Monitoring</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Passive signals screened by Jev. These are signals, not findings: only human sessions
            produce findings and issues.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Link
            href={`/products/${product.id}/monitoring/live`}
            className="rounded-full bg-foreground px-3 py-1.5 font-medium text-background transition-opacity hover:opacity-90"
          >
            Live analysis
          </Link>
          <Pill
            ok={o.policy.enabled}
            label={o.policy.enabled ? "Collection on" : "Collection off"}
          />
          <Pill
            ok={o.providers.jev}
            label={o.providers.jev ? "Jev configured" : "Jev not configured"}
          />
          <Pill
            ok={o.providers.jevPriced}
            label={o.providers.jevPriced ? "Spend cap enforced" : "Costs unpriced"}
          />
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        <Stat
          label="Observation sessions"
          value={o.collection.observationSessions}
          hint={`${o.collection.observationSessionsLast24h} in 24h`}
        />
        <Stat
          label="Journeys observed"
          value={o.collection.journeys}
          hint={`${o.collection.events} events`}
        />
        <Stat
          label="Evaluations today"
          value={o.evaluationSummary.today?.evaluations ?? 0}
          hint={`${o.evaluationSummary.today?.inputTokens ?? 0} in / ${o.evaluationSummary.today?.outputTokens ?? 0} out tokens · ${fmtCost(o.providers.jevPriced ? (o.evaluationSummary.today?.estimatedCostMicros ?? 0) : null)}`}
        />
        <Stat
          label="Candidates"
          value={o.candidates.filter((c) => c.state === "proposed").length}
          hint={`${o.candidates.length} total`}
        />
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <div className="surface p-5">
            <h2 className="text-sm font-semibold">Research candidates</h2>
            <p className="text-xs text-muted-foreground">
              Grouped by journey, target, category, build and detector. Counts are distinct
              observation sessions and journeys, never people. Trigger-selected data is not an
              unbiased estimate of all-user friction.
            </p>
            {o.candidates.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">No candidates yet.</p>
            ) : null}
            <ul className="mt-4 space-y-3">
              {o.candidates.map((c) => (
                <li key={c.id} className="rounded-xl border border-border/70 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${c.state === "proposed" ? "bg-brand/10 text-brand" : c.state === "dismissed" ? "bg-secondary text-muted-foreground" : "bg-success/15 text-success"}`}
                    >
                      {c.state.replace("_", " ")}
                    </span>
                    <p className="font-medium">
                      {c.journeyId} · {c.category.replace(/_/g, " ")} · {c.targetRef}
                    </p>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{c.suspectedProblem}</p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-4">
                    <dt>Sessions</dt>
                    <dd className="text-foreground">{c.distinctObservationSessions}</dd>
                    <dt>Journeys</dt>
                    <dd className="text-foreground">{c.distinctJourneyInstances}</dd>
                    <dt>Friction (model p)</dt>
                    <dd className="text-foreground">
                      {c.latestFrictionPermille !== null
                        ? (c.latestFrictionPermille / 1000).toFixed(2)
                        : "—"}
                    </dd>
                    <dt>Research (model p)</dt>
                    <dd className="text-foreground">
                      {c.latestResearchPermille !== null
                        ? (c.latestResearchPermille / 1000).toFixed(2)
                        : "—"}
                    </dd>
                  </dl>
                  {c.evidenceLimitations.length ? (
                    <p className="mt-2 text-xs text-warning-foreground text-muted-foreground">
                      Limitations: {c.evidenceLimitations.join("; ")}
                    </p>
                  ) : null}
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Build {c.baselineBuildRef} · detector {c.detectorRef} ·{" "}
                    {c.evaluationRefs.length} evaluation{c.evaluationRefs.length === 1 ? "" : "s"}
                    {c.stateReason ? ` · ${c.stateReason}` : ""}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <CandidateActions
                      candidateId={c.id}
                      state={c.state}
                      devinReady={o.providers.devin}
                    />
                    {c.studyIds.map((sid) => (
                      <Link
                        key={sid}
                        href={`/studies/${sid}`}
                        className="text-xs text-brand underline-offset-4 hover:underline"
                      >
                        Linked study
                      </Link>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="surface p-5">
            <h2 className="text-sm font-semibold">Evaluations</h2>
            <p className="text-xs text-muted-foreground">
              Trigger versus random sample, requested and returned model, tokens. Unavailable
              outcomes are shown, never converted to "no friction".
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
              {Object.entries(o.evaluationSummary.byStatus).map(([k, v]) => (
                <span key={k} className="rounded-full bg-secondary px-2 py-0.5">
                  {k}: {v}
                </span>
              ))}
              {Object.entries(o.evaluationSummary.byTrigger).map(([k, v]) => (
                <span key={k} className="rounded-full bg-secondary px-2 py-0.5">
                  {k}: {v}
                </span>
              ))}
            </div>
            <table className="mt-3 w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">When</th>
                  <th className="font-medium">Trigger</th>
                  <th className="font-medium">Status</th>
                  <th className="font-medium">Model</th>
                  <th className="font-medium">Friction</th>
                  <th className="font-medium">Evidence</th>
                  <th className="font-medium">Window</th>
                </tr>
              </thead>
              <tbody>
                {o.evaluations.slice(0, 25).map((e) => {
                  const a = (e.answers ?? {}) as Record<string, { noul?: number; choice?: string }>;
                  return (
                    <tr key={e.id} className="border-t border-border/60">
                      <td className="py-1.5">{new Date(e.requestedAt).toLocaleTimeString()}</td>
                      <td>{e.triggerReason}</td>
                      <td
                        className={
                          e.status === "completed"
                            ? "text-success"
                            : e.status === "failed"
                              ? "text-destructive"
                              : ""
                        }
                      >
                        {e.status}
                        {e.statusReason && e.status !== "queued" ? (
                          <span className="block text-[10px] text-muted-foreground">
                            {e.statusReason.slice(0, 60)}
                          </span>
                        ) : null}
                      </td>
                      <td>{e.returnedModel ?? e.requestedModel}</td>
                      <td>
                        {a.ux_friction_observed?.noul !== undefined
                          ? a.ux_friction_observed.noul.toFixed(2)
                          : "—"}
                      </td>
                      <td>{a.evidence_sufficiency?.choice ?? "—"}</td>
                      <td className="text-muted-foreground">
                        {e.window ? `${e.window.events} ev · ${e.window.gaps.length} gaps` : "—"}
                      </td>
                    </tr>
                  );
                })}
                {o.evaluations.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-3 text-muted-foreground">
                      No evaluations yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="space-y-6">
          <div className="surface p-5">
            <h2 className="text-sm font-semibold">Detectors</h2>
            <p className="text-xs text-muted-foreground">
              {activeDetectors.length} active · last observed build{" "}
              {o.collection.lastBuildRef ?? "—"}
            </p>
            <ul className="mt-3 space-y-2 text-xs">
              {o.detectors.map((d) => (
                <li key={d.id} className="rounded-lg border border-border/70 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {d.detectorId} v{d.version}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] ${d.status === "active" ? "bg-success/15 text-success" : d.status === "stale" || d.status === "needs_instrumentation" ? "bg-warning/15" : "bg-secondary"}`}
                    >
                      {d.status.replace("_", " ")}
                    </span>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    {d.journeyId} · build {d.appBuildRef} · {d.provenance} · {d.questionCount}{" "}
                    questions
                  </p>
                  <p className="text-muted-foreground">Needs: {d.requiredEvents.join(", ")}</p>
                  {d.statusReason ? (
                    <p className="mt-1 text-muted-foreground">{d.statusReason}</p>
                  ) : null}
                </li>
              ))}
              {o.detectors.length === 0 ? (
                <li className="text-muted-foreground">
                  No detectors. Publish one or generate from code.
                </li>
              ) : null}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              Observed event types: {o.collection.observedEventTypes.join(", ") || "none yet"}
            </p>
          </div>
          <div className="surface p-5">
            <h2 className="text-sm font-semibold">Policy · revision {o.policy.revision}</h2>
            <p className="text-xs text-muted-foreground">
              Tuning parameters, not guarantees. Collection is off by default.
            </p>
            <PolicyForm productId={product.id} policy={o.policy} />
          </div>
        </aside>
      </section>
    </Shell>
  );
}

function Pill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 font-medium ${ok ? "bg-success/15 text-success" : "bg-secondary text-muted-foreground"}`}
    >
      {label}
    </span>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="surface p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
