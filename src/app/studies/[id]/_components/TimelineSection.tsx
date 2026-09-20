import type { TimelineStage } from "@/services/timeline";

export function TimelineSection({ stages }: { stages: TimelineStage[] }) {
  return (
    <section>
      <h2>Timeline</h2>
      <ol>
        {stages.map((stage) => (
          <li key={stage.key}>
            <strong>{stage.label}</strong>: {stage.state}
            {stage.count !== undefined && ` · ${stage.count}`}
            {stage.waitingReason && <span className="muted"> · {stage.waitingReason}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
