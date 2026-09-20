import type { signal } from "@/db/schema";

type Signal = typeof signal.$inferSelect;

export function SignalsPanel({ signals }: { signals: Signal[] }) {
  return (
    <section>
      <h2>Signals</h2>
      {signals.length === 0 && <p className="muted">No continuous-activity signals yet.</p>}
      <div className="grid">
        {signals.map((signal) => (
          <article className="card" key={signal.id}>
            <h3>{signal.title}</h3>
            <p>
              <strong aria-label={`severity ${signal.severity}`}>{signal.severity}</strong> ·{" "}
              {signal.semanticTarget}
            </p>
            <p>{signal.description}</p>
            <p>
              {signal.observedSessions === null
                ? "unknown sessions in window"
                : `${signal.observedSessions} sessions in window`}
            </p>
            <p className="muted">
              {signal.windowStart.toISOString()} – {signal.windowEnd.toISOString()}
            </p>
            <small className="muted">hint — no session evidence</small>
          </article>
        ))}
      </div>
    </section>
  );
}
