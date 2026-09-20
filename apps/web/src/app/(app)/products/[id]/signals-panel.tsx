import type { SignalRow } from "@/domain/signals";

const SEVERITY_STYLE: Record<string, string> = {
  high: "bg-destructive/10 text-destructive",
  medium: "bg-warning/15 text-foreground",
  low: "bg-secondary text-muted-foreground",
};

/** Jev signals are hints, not findings: no session evidence, never issues or repairs. */
export function SignalsPanel({ signals }: { signals: SignalRow[] }) {
  return (
    <section className="surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Signals from continuous monitoring
        </p>
        <span className="text-xs text-muted-foreground">hints, not findings</span>
      </div>
      {signals.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No Jev signals yet — POST /api/products/:id/signals
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {signals.map((signal) => (
            <li key={signal.id} className="rounded-xl border border-border/70 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{signal.title}</p>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SEVERITY_STYLE[signal.severity] ?? "bg-secondary"}`}
                >
                  {signal.severity}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {signal.semanticTarget}
                </span>
              </div>
              <p className="mt-2">{signal.description}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {new Date(signal.windowStart).toLocaleString()} –{" "}
                {new Date(signal.windowEnd).toLocaleString()}
                {signal.observedSessions.length
                  ? ` · ${signal.observedSessions.length} observed sessions`
                  : ""}
                {signal.evidenceRef ? ` · evidence ${signal.evidenceRef}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
