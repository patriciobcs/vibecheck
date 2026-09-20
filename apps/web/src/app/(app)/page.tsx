import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { currentSession } from "@/auth/current-user";
import { NavLink, Shell } from "@/components/layout/shell";
import { Button } from "@/components/ui/button";
import { HowItWorks, JourneyFigure } from "./landing-parts";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await currentSession().catch(() => null);
  const enter = session ? "/products" : "/sign-in?next=/products";
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
            {session ? "Workspace" : "Sign in"}
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
            Seamless UX listens to the shape of a journey, never its content. Jev reads where people
            struggle, and the strongest signals become short studies with real people.
          </p>
          <p className="mt-2 text-lg">
            <Link href="/marketplace" className="underline underline-offset-4 hover:opacity-80">
              Taking part in a study? →
            </Link>
          </p>
          <Button asChild size="lg" className="mt-8 rounded-full px-7">
            <Link href="/products/new">Add your project</Link>
          </Button>
          <p className="mt-3 text-sm text-muted-foreground">
            Sign in, then add your project name and GitHub repository.
          </p>
        </div>
        <JourneyFigure />
      </section>

      <WorkflowChart />

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
          <Link href="/products/new">Add your project</Link>
        </Button>
      </section>
    </Shell>
  );
}

const WORKFLOW = [
  {
    tool: "SDK + Jev",
    title: "Spot friction",
    description: "App events help Jev flag journeys worth exploring in a study.",
  },
  {
    tool: "Vonage",
    title: "Record a study",
    description: "People try a task. Vonage records their audio and optional screen, with consent.",
  },
  {
    tool: "SLNG",
    title: "Transcribe",
    description: "SLNG turns the session audio into a transcript with timestamps.",
  },
  {
    tool: "Devin",
    title: "Find insights",
    description: "Devin analyzes transcripts and app events to produce findings with evidence.",
  },
  {
    tool: "Devin + GitHub",
    title: "Create a PR",
    description: "Devin proposes a code change. Checks run before a draft pull request opens.",
  },
  {
    tool: "Vercel",
    title: "Deploy a preview",
    description: "Vercel builds the candidate commit into a preview you can try and review.",
  },
];

function WorkflowChart() {
  return (
    <section
      aria-labelledby="workflow-heading"
      className="border-t border-border/70 py-20 md:py-28"
    >
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
        The tools behind the flow
      </p>
      <h2 id="workflow-heading" className="mt-3 text-3xl font-medium tracking-tight md:text-4xl">
        From user friction to a working preview.
      </h2>
      <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
        See how the connected tools turn a research question into recorded evidence, useful
        insights, and a proposed improvement.
      </p>
      <figure className="mt-10">
        <ol className="grid gap-7 xl:grid-cols-6" aria-label="Research and improvement workflow">
          {WORKFLOW.map((step, index) => (
            <li key={step.title} className="relative min-w-0">
              <div className="flex h-full gap-4 rounded-2xl border border-border/70 bg-card p-5 xl:block">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand/10 font-mono text-xs text-foreground xl:mb-5">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">{step.tool}</p>
                  <h3 className="mt-2 text-lg font-medium tracking-tight">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {step.description}
                  </p>
                </div>
              </div>
              {index < WORKFLOW.length - 1 ? (
                <ArrowRight
                  aria-hidden="true"
                  className="absolute -bottom-6 left-1/2 size-5 -translate-x-1/2 rotate-90 text-muted-foreground xl:-right-6 xl:bottom-auto xl:left-auto xl:top-1/2 xl:-translate-y-1/2 xl:translate-x-0 xl:rotate-0"
                />
              ) : null}
            </li>
          ))}
        </ol>
        <figcaption className="mt-6 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Flow overview with integrations configured. Jev guides research from app events;
          recordings and transcripts support the findings. PRs require a connected repository and
          enabled code changes. Deployments are previews for review.
        </figcaption>
      </figure>
    </section>
  );
}
