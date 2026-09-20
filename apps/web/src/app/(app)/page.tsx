import Link from "next/link";
import { currentSession } from "@/auth/current-user";
import { NavLink, Shell } from "@/components/layout/shell";
import { Button } from "@/components/ui/button";
import { env } from "@/lib/env";
import { providerStatus } from "@/providers";

export const dynamic = "force-dynamic";

const STEPS = [
  {
    n: "01",
    title: "Observe",
    text: "Your app reports a few allowlisted events: journey start, progress, help, errors. No text, no screenshots, and only with permission.",
  },
  {
    n: "02",
    title: "Screen",
    text: "Deterministic triggers cut a bounded window. Jev estimates friction and whether research is warranted. Signals, never findings.",
  },
  {
    n: "03",
    title: "Study",
    text: "Real people take one neutral task and think out loud. Their actions and transcript become evidence you can act on.",
  },
];

export default async function Home() {
  const session = await currentSession().catch(() => null);
  const demo = env().demo;
  const providers = providerStatus();
  const enter = session ? "/products" : demo ? "/api/demo/enter?next=/products" : "/sign-in";
  return (
    <Shell
      nav={
        <>
          <NavLink href="/products">Products</NavLink>
          <NavLink href="/marketplace">Studies</NavLink>
          {session ? (
            <span className="px-3 text-foreground">{session.user.email}</span>
          ) : (
            <NavLink href={enter}>{demo ? "Enter demo" : "Sign in"}</NavLink>
          )}
        </>
      }
    >
      <section className="pt-8 pb-14 md:pt-16">
        <p className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Continuous UX research
        </p>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight md:text-6xl md:leading-[1.05]">
          Find the friction. Then ask real people.
        </h1>
        <p className="mt-5 max-w-xl text-lg text-muted-foreground">
          VibeCheck listens to semantic signals from your product, screens them with Jev, and turns
          the strongest into short studies with real users. Evidence, not opinions.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg" className="rounded-full px-6">
            <Link href={enter}>
              {session ? "Open workspace" : demo ? "Open the demo" : "Sign in"}
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="rounded-full px-6">
            <Link href="/marketplace">Open studies</Link>
          </Button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {STEPS.map((s) => (
          <article key={s.n} className="surface p-6">
            <p className="font-mono text-xs text-muted-foreground">{s.n}</p>
            <h2 className="mt-3 text-lg font-semibold tracking-tight">{s.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.text}</p>
          </article>
        ))}
      </section>

      <section className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-secondary/60 px-6 py-5 text-sm">
        <p className="max-w-xl text-muted-foreground">
          Nothing is simulated: every number on screen is a stored event, a real model answer or a
          verified recording. Unconfigured providers fail visibly.
        </p>
        {!demo ? (
          <p className="text-xs text-muted-foreground">
            Vonage {providers.vonage ? "on" : "off"} · SLNG {providers.slng ? "on" : "off"} · Jev{" "}
            {providers.jev ? "on" : "off"} · Devin {providers.devin ? "on" : "off"}
          </p>
        ) : null}
      </section>
    </Shell>
  );
}
