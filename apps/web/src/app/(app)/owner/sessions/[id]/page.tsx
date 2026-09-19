import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentSession } from "@/auth/current-user";
import { NavLink, SampleBadge, Shell } from "@/components/layout/shell";
import { sessionEvidence } from "@/domain/owner";
import { EvidencePlayer } from "./evidence-player";

export const dynamic = "force-dynamic";

/** Evidence review: synchronized player, transcript and event timeline (VC-06 shape, VC-02 data). */
export default async function SessionEvidencePage({ params }: PageProps<"/owner/sessions/[id]">) {
  const auth = await currentSession();
  if (!auth) redirect("/sign-in?next=/owner");
  const { id } = await params;
  const evidence = await sessionEvidence(auth.user.id, id).catch(() => null);
  if (!evidence) notFound();

  const missing: string[] = [];
  if (evidence.assets.length === 0) missing.push("no media archive was created");
  for (const a of evidence.assets)
    if (a.status !== "verified")
      missing.push(
        `archive ${a.id.slice(-6)} is ${a.status}${a.failureReason ? ` (${a.failureReason})` : ""}`,
      );
  if (evidence.session.instrumentation === "video_only")
    missing.push("target was not instrumented: video and audio only");
  if (evidence.session.transcriptStatus !== "done")
    missing.push(`transcript ${evidence.session.transcriptStatus}`);

  return (
    <Shell
      wide
      nav={
        <>
          <NavLink href="/owner">Owner</NavLink>
          <span className="px-3 text-foreground">{auth.user.email}</span>
        </>
      }
    >
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/owner" className="text-xs text-muted-foreground hover:text-foreground">
            ← All sessions
          </Link>
          <div className="mt-2 flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Session evidence</h1>
            {evidence.provenance === "sample" ? <SampleBadge /> : null}
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {evidence.task?.participant_prompt}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
          <Meta k="Assignment" v={evidence.assignment.state} />
          <Meta k="Channel" v={evidence.assignment.channel.replace("_", " ")} />
          <Meta k="Reported" v={evidence.session.participantReportedOutcome.replace("_", " ")} />
          <Meta k="Instrumented" v={evidence.session.instrumentedOutcome.replace("_", " ")} />
          <Meta
            k="Difficulty"
            v={
              evidence.session.perceivedDifficulty
                ? `${evidence.session.perceivedDifficulty}/5`
                : "—"
            }
          />
          <Meta k="Consent" v={evidence.assignment.consentVersion ?? "—"} />
          <Meta k="Commit" v={evidence.assignment.testedCommitSha.slice(0, 10)} />
          <Meta k="Fixture" v={evidence.assignment.fixtureRef.split(":")[0] ?? "—"} />
        </dl>
      </div>

      {missing.length > 0 ? (
        <div className="mb-6 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm">
          <p className="font-medium">Evidence limitations</p>
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">
            {missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <EvidencePlayer evidence={evidence} />

      {evidence.session.comments ? (
        <section className="surface mt-6 p-5 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Participant comments
          </p>
          <p className="mt-2">{evidence.session.comments}</p>
        </section>
      ) : null}

      <section className="mt-6 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Processing</p>
        <ul className="mt-1 space-y-1">
          {evidence.jobs.length === 0 ? (
            <li>No processing jobs yet. Archive callbacks arrive after the recording stops.</li>
          ) : null}
          {evidence.jobs.map((j) => (
            <li key={j.id} className="font-mono">
              {j.type} · {j.status} · attempts {j.attempts}
              {j.lastError ? ` · ${j.lastError}` : ""}
            </li>
          ))}
        </ul>
      </section>
    </Shell>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="uppercase tracking-wide">{k}</dt>
      <dd className="capitalize text-foreground">{v}</dd>
    </div>
  );
}
