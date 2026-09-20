import Link from "next/link";
import { currentSession } from "@/auth/current-user";
import { NavLink, Shell } from "@/components/layout/shell";
import { Button } from "@/components/ui/button";
import { env } from "@/lib/env";
import { HowItWorks, JourneyFigure } from "./landing-parts";

export const dynamic = "force-dynamic";

/** Lean landing: one headline, one call to action, one real journey; then how it works. */
export default async function Home() {
  const session = await currentSession().catch(() => null);
  const demo = env().demo;
  const enter = session ? "/products" : demo ? "/api/demo/enter?next=/products" : "/sign-in";
  return (
    <Shell
      wide
      nav={
        <div className="flex items-center gap-0.5 rounded-full border border-border/70 bg-card p-0.5 text-xs">
          <span className="hidden sm:contents">
            <NavLink href="/products">Owners</NavLink>
            <NavLink href="/marketplace">Participants</NavLink>
          </span>
          <Link
            href={enter}
            className="whitespace-nowrap rounded-full bg-foreground px-3 py-1.5 text-background transition-opacity hover:opacity-90"
          >
            {session ? "Workspace" : demo ? "Enter demo" : "Sign in"}
          </Link>
        </div>
      }
    >
      <section className="grid items-center gap-12 py-14 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:py-28">
        <div>
          <h1 className="text-[2.75rem] font-medium leading-[1.05] tracking-tight md:text-[3.75rem]">
            Your users are already telling you what is broken.
          </h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-foreground/80">
            VibeCheck listens to the shape of a journey, never its content. Jev reads where people
            struggle, and the strongest signals become short studies with real people.
          </p>
          <p className="mt-2 text-lg">
            <Link href="/marketplace" className="underline underline-offset-4 hover:opacity-80">
              Taking part in a study? →
            </Link>
          </p>
          <Button asChild size="lg" className="mt-8 rounded-full px-7">
            <Link href={enter}>
              {session ? "Open workspace" : demo ? "Open the demo" : "Sign in"}
            </Link>
          </Button>
        </div>
        <JourneyFigure />
      </section>

      <section className="border-t border-border/70 py-20 md:py-28">
        <HowItWorks />
      </section>

      <section className="border-t border-border/70 py-20 text-center md:py-28">
        <h2 className="mx-auto max-w-2xl text-3xl font-medium tracking-tight md:text-5xl">
          Signals, not findings. Until real people confirm them.
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground">
          Nothing on screen is simulated: every number is a stored event, a real model answer or a
          verified recording. Model estimates are labeled as estimates, sample data as sample.
        </p>
        <Button asChild size="lg" className="mt-8 rounded-full px-7">
          <Link href={enter}>
            {session ? "Open workspace" : demo ? "Open the demo" : "Sign in"}
          </Link>
        </Button>
      </section>
    </Shell>
  );
}
