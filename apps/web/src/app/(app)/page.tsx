import Link from "next/link";
import { currentSession } from "@/auth/current-user";
import { NavLink, Shell } from "@/components/layout/shell";
import { Button } from "@/components/ui/button";
import { providerStatus } from "@/providers";

export default async function Home() {
  const session = await currentSession();
  const providers = providerStatus();
  return (
    <Shell
      nav={
        <>
          <NavLink href="/marketplace">Marketplace</NavLink>
          <NavLink href="/owner">Owner</NavLink>
          {session ? (
            <span className="px-3 text-foreground">{session.user.email}</span>
          ) : (
            <NavLink href="/sign-in">Sign in</NavLink>
          )}
        </>
      }
    >
      <section className="grid gap-12 py-10 md:grid-cols-[1.2fr_1fr] md:items-center">
        <div>
          <p className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Test delivery and recording
          </p>
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
            Real people, one honest task, evidence you can replay.
          </h1>
          <p className="mt-4 max-w-xl text-lg text-muted-foreground">
            Invite testers by link, in-app toast or marketplace. They read a neutral task, consent
            to exactly what is captured, and record screen and voice. Everything uploads with
            aligned events and a transcript.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg" className="rounded-full px-6">
              <Link href="/marketplace">Browse open studies</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="rounded-full px-6">
              <Link href="/owner">Owner dashboard</Link>
            </Button>
          </div>
        </div>
        <div className="surface p-6">
          <h2 className="text-sm font-semibold">Local status</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <Status
              label="Vonage Video"
              ok={providers.vonage}
              hint="VONAGE_APPLICATION_ID + private key"
            />
            <Status
              label="Vonage callback secret"
              ok={providers.vonageCallbackSecret}
              hint="VONAGE_ARCHIVE_SIGNATURE_SECRET"
            />
            <Status label="SLNG transcription" ok={providers.slng} hint="SLNG_API_KEY" />
          </dl>
          <p className="mt-5 text-xs text-muted-foreground">
            Unconfigured providers block recording with a visible error. Nothing is simulated.
          </p>
        </div>
      </section>
    </Shell>
  );
}

function Status({ label, ok, hint }: { label: string; ok: boolean; hint: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <dt className="font-medium">{label}</dt>
        <dd className="text-xs text-muted-foreground">{hint}</dd>
      </div>
      <span
        className={
          ok
            ? "rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success"
            : "rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground"
        }
      >
        {ok ? "Configured" : "Missing"}
      </span>
    </div>
  );
}
