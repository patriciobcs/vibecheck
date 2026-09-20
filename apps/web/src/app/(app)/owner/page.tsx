import Link from "next/link";
import { redirect } from "next/navigation";
import { currentSession } from "@/auth/current-user";
import { NavLink, SampleBadge, Shell } from "@/components/layout/shell";
import { ownerOverview } from "@/domain/owner";
import { env } from "@/lib/env";
import { InviteLinkButton } from "./invite-link-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Owner" };

const STATE_LABEL: Record<string, string> = {
  assigned: "Claimed",
  consent: "Consenting",
  device_check: "Device check",
  recording: "Recording",
  submitting: "Uploading",
  complete: "Complete",
  withdrawn: "Withdrawn",
  incomplete: "Incomplete",
  expired: "Expired",
};

/** Minimal owner view for VC-02: studies, invitations, sessions. The full dashboard is VC-06. */
export default async function OwnerPage() {
  const session = await currentSession();
  if (!session) redirect("/sign-in?next=/owner");
  const overview = await ownerOverview(session.user.id);
  const demo = env().demo;

  return (
    <Shell
      wide
      nav={
        <>
          <NavLink href="/products">Products</NavLink>
          <NavLink href="/marketplace">Marketplace</NavLink>
          <NavLink href="/operations">Operations</NavLink>
          <span className="px-3 text-foreground">{session.user.email}</span>
        </>
      }
    >
      <div className="mb-8 flex items-end justify-between gap-6">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Owner
          </p>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Studies and sessions
          </h1>
        </div>
      </div>

      {overview.tenants.length === 0 ? (
        <div className="surface p-8 text-center">
          <p className="font-medium">You are not a member of any product yet.</p>
          {!demo ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Run <code className="font-mono text-xs">pnpm db:seed</code> and sign in with the seed
              owner email to see the sample study.
            </p>
          ) : null}
        </div>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2">
        {overview.studies.map((s) => (
          <article key={s.id} className="surface p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{s.product?.name}</p>
                  {s.product?.sample || s.provenance === "sample" ? <SampleBadge /> : null}
                </div>
                <h2 className="mt-1 text-lg font-medium tracking-tight">
                  {s.task?.research_question ?? "Untitled study"}
                </h2>
              </div>
              <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium capitalize">
                {s.status}
              </span>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{s.task?.participant_prompt}</p>
            <dl className="mt-5 grid grid-cols-4 gap-3 text-center">
              <Stat label="Target" value={s.counts.target} />
              <Stat label="Claimed" value={s.counts.claimed} />
              <Stat label="Complete" value={s.counts.completed} />
              <Stat label="Withdrawn" value={s.counts.withdrawn + s.counts.incomplete} />
            </dl>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>
                Revision {s.revision} · via {s.recruitment?.source.replace("_", " ")} ·{" "}
                {s.invitations.length} direct link{s.invitations.length === 1 ? "" : "s"}
              </span>
              <InviteLinkButton studyId={s.id} />
            </div>
            {s.product && !demo ? (
              <p className="mt-4 rounded-xl bg-secondary/70 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                SDK: &lt;script src="/sdk/vibecheck.js" data-key="{s.product.publishableKey}"
                defer&gt;&lt;/script&gt;
              </p>
            ) : null}
          </article>
        ))}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold tracking-tight">Sessions</h2>
        <p className="text-sm text-muted-foreground">
          Actual persisted state. Missing media stays visible as missing.
        </p>
        <div className="surface mt-4 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Started</th>
                <th className="px-4 py-2 font-medium">Channel</th>
                <th className="px-4 py-2 font-medium">State</th>
                <th className="px-4 py-2 font-medium">Media</th>
                <th className="px-4 py-2 font-medium">Transcript</th>
                <th className="px-4 py-2 font-medium">Reported</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {overview.sessions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                    No sessions yet. Share a direct link or open the marketplace.
                  </td>
                </tr>
              ) : null}
              {overview.sessions.map((s) => (
                <tr key={s.id} className="border-t border-border/70">
                  <td className="px-4 py-3">
                    {s.startedAt ? new Date(s.startedAt).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-3 capitalize">{s.channel?.replace("_", " ")}</td>
                  <td className="px-4 py-3">{STATE_LABEL[s.state] ?? s.state}</td>
                  <td className="px-4 py-3 capitalize">{s.completeness}</td>
                  <td className="px-4 py-3 capitalize">{s.transcriptStatus}</td>
                  <td className="px-4 py-3 capitalize">{s.outcome.replace("_", " ")}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/owner/sessions/${s.id}`}
                      className="text-brand underline-offset-4 hover:underline"
                    >
                      Evidence
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </Shell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-secondary/70 py-3">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
