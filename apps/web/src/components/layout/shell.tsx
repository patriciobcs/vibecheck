import { cn } from "cn";
import Link from "next/link";
import type { ReactNode } from "react";

export function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}
    >
      <span className="inline-block size-2.5 rounded-full bg-brand" aria-hidden />
      VibeCheck
    </Link>
  );
}

export function Shell({
  children,
  nav,
  wide,
}: {
  children: ReactNode;
  nav?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/80 backdrop-blur-xl">
        <div
          className={cn(
            "mx-auto flex h-14 items-center justify-between px-6",
            wide ? "max-w-7xl" : "max-w-5xl",
          )}
        >
          <Wordmark />
          <nav className="flex items-center gap-1 text-sm text-muted-foreground">{nav}</nav>
        </div>
      </header>
      <main className={cn("mx-auto w-full flex-1 px-6 py-10", wide ? "max-w-7xl" : "max-w-5xl")}>
        {children}
      </main>
      <footer className="hairline py-6 text-center text-xs text-muted-foreground">
        Real people. Honest feedback. Tested improvements.
      </footer>
    </div>
  );
}

export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-full px-3 py-1.5 transition-colors hover:bg-secondary hover:text-foreground"
    >
      {children}
    </Link>
  );
}

export function PageTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
}) {
  return (
    <div className="mb-8">
      {eyebrow ? (
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {eyebrow}
        </p>
      ) : null}
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{title}</h1>
      {description ? (
        <p className="mt-2 max-w-2xl text-base text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

export function SampleBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-foreground">
      Sample data
    </span>
  );
}
