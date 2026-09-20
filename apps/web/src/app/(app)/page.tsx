import Link from "next/link";
import { currentSession } from "@/auth/current-user";
import { NavLink, Shell } from "@/components/layout/shell";
import { Button } from "@/components/ui/button";
import { env } from "@/lib/env";
import { providerStatus } from "@/providers";

export const dynamic = "force-dynamic";

/** From the recorded demo run on 2026-09-21 (jev-1.13.0); shown as an example, not a promise. */
const EXAMPLE_LOG = [
  ["0:04.1", "journey_start", "journey_id=share_drawing"],
  ["0:04.1", "progress", "progress_ref=drawing_started"],
  ["0:07.9", "action_attempt", "action_ref=share_button"],
  ["0:09.3", "action_result", "action_ref=share_button result=cancelled"],
  ["0:13.1", "action_attempt", "action_ref=save_to_file"],
  ["0:15.0", "action_result", "action_ref=save_to_file result=cancelled"],
  ["0:17.4", "help_request", "target_ref=help_dialog"],
  ["0:21.0", "navigation", "route_template=/menu/main"],
  ["0:22.6", "action_result", "action_ref=export_image result=success"],
  ["0:22.6", "completion", "progress_ref=image_exported"],
] as const;
const EXAMPLE_READING = [
  ["Friction observed", 0.95],
  ["Wrong path taken", 0.97],
  ["Recovered after help", 0.97],
  ["Research warranted", 0.81],
] as const;

const PIPELINE = [
  {
    step: "Observe",
    text: "Your app reports a small vocabulary of events: journey start, attempt, result, help, completion. With permission, without content.",
  },
  {
    step: "Screen",
    text: "Deterministic triggers cut a bounded window. Jev estimates friction, wrong paths and whether research is warranted.",
  },
  {
    step: "Study",
    text: "One neutral task for real people who think out loud. Actions and speech on one clock, no screen recording needed.",
  },
  {
    step: "Evidence",
    text: "Transcript, actions and answers become findings you can cite. Every number keeps its source.",
  },
];

const NEVER = [
  "Typed text or clipboard",
  "Screenshots or DOM content",
  "Names, emails, identities",
  "Anything without permission",
];
const ALWAYS = [
  "Every number's source",
  "Model estimates labeled as such",
  "Sample data labeled as sample",
  "Provider failures shown, never hidden",
];

export default async function Home() {
  const session = await currentSession().catch(() => null);
  const demo = env().demo;
  const providers = providerStatus();
  const enter = session ? "/products" : demo ? "/api/demo/enter?next=/products" : "/sign-in";
  return (
    <Shell
      wide
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
      <section className="grid gap-10 pt-6 md:grid-cols-[1.05fr_1fr] md:items-center md:pt-12">
        <div>
          <p className="mb-3 font-mono text-xs text-muted-foreground">continuous ux research</p>
          <h1 className="text-4xl font-semibold tracking-tight md:text-[3.6rem] md:leading-[1.02]">
            Your users are already telling you what is broken.
          </h1>
          <p className="mt-5 max-w-lg text-lg text-muted-foreground">
            VibeCheck listens to the shape of a journey, not its content. Jev reads where people
            struggle. The strongest signals become short studies with real people, and the studies
            become evidence.
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
        </div>

        <figure className="overflow-hidden rounded-2xl border border-border/70 bg-[#0f1115] text-[#d8dbe2] shadow-[var(--shadow-float)]">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-2 text-[11px] text-white/50">
            <span className="font-medium text-white">
              A visitor wants an image of their drawing
            </span>
            <span className="font-mono">semantic log · excalidraw</span>
          </div>
          <div className="px-4 py-3 font-mono text-[11.5px] leading-[1.7]">
            {EXAMPLE_LOG.map(([t, type, detail], i) => (
              <div
                key={t + type}
                className="live-in flex gap-2.5"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <span className="w-12 shrink-0 text-white/40">{t}</span>
                <span className={`w-28 shrink-0 ${tone(type)}`}>{type}</span>
                <span className="text-white/75">{detail}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-white/10 bg-white/[0.03] px-4 py-3">
            <p className="mb-2 text-[11px] text-white/50">
              What Jev reads into it{" "}
              <span className="text-white/30">
                · evidence sufficient · share mistaken for export
              </span>
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              {EXAMPLE_READING.map(([label, v]) => (
                <div key={label}>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-white/60">{label}</span>
                    <span className="tabular-nums text-white">{Math.round(v * 100)}%</span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-[#6f7cff]"
                      style={{ width: `${v * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-[#5fd38d]">
              Above the gate → research candidate → study
            </p>
          </div>
          <figcaption className="border-t border-white/10 px-4 py-2 text-[10.5px] text-white/40">
            From a recorded demo run, model jev-1.13.0. An example, not a benchmark.
          </figcaption>
        </figure>
      </section>

      <section className="mt-16">
        <ol className="grid gap-px overflow-hidden rounded-2xl border border-border/70 bg-border/70 md:grid-cols-4">
          {PIPELINE.map((p, i) => (
            <li key={p.step} className="bg-card p-6">
              <p className="font-mono text-xs text-muted-foreground">0{i + 1}</p>
              <h2 className="mt-2 text-lg font-semibold tracking-tight">
                {p.step}
                {i < PIPELINE.length - 1 ? (
                  <span className="ml-2 text-muted-foreground">→</span>
                ) : null}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-10 grid gap-4 md:grid-cols-2">
        <div className="surface p-6">
          <h2 className="text-sm font-semibold tracking-tight">Never captured</h2>
          <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
            {NEVER.map((n) => (
              <li key={n} className="flex gap-2">
                <span className="text-destructive">×</span>
                {n}
              </li>
            ))}
          </ul>
        </div>
        <div className="surface p-6">
          <h2 className="text-sm font-semibold tracking-tight">Always shown</h2>
          <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
            {ALWAYS.map((n) => (
              <li key={n} className="flex gap-2">
                <span className="text-success">✓</span>
                {n}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {!demo ? (
        <p className="mt-8 text-xs text-muted-foreground">
          Providers: Vonage {providers.vonage ? "on" : "off"} · SLNG {providers.slng ? "on" : "off"}{" "}
          · Jev {providers.jev ? "on" : "off"} · Devin {providers.devin ? "on" : "off"}
        </p>
      ) : null}
    </Shell>
  );
}

function tone(type: string) {
  if (type === "help_request") return "text-[#ff7b72]";
  if (type === "action_result" || type === "completion") return "text-[#5fd38d]";
  if (type === "action_attempt") return "text-[#f2cc60]";
  if (type === "navigation") return "text-[#79c0ff]";
  return "text-[#d2a8ff]";
}
