import type { TimelineStage } from "@/domain/timeline";

const STATE_STYLE: Record<string, string> = {
  done: "border-success/40 bg-success/10 text-success",
  active: "border-brand/40 bg-brand/10 text-brand",
  waiting: "border-border bg-secondary/60 text-muted-foreground",
  skipped: "border-border/50 bg-secondary/40 text-muted-foreground line-through",
  blocked: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function TimelineSection({ stages }: { stages: TimelineStage[] }) {
  return (
    <section className="surface p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Timeline</p>
      <ol className="mt-3 flex flex-wrap items-stretch gap-2">
        {stages.map((stage, i) => (
          <li key={stage.key} className="flex items-center gap-2">
            {i > 0 ? <span className="text-muted-foreground">→</span> : null}
            <div
              className={`rounded-xl border px-3 py-2 text-sm ${STATE_STYLE[stage.state] ?? ""}`}
            >
              <p className="font-medium">
                {stage.label}
                {stage.count !== undefined ? ` · ${stage.count}` : ""}
              </p>
              {stage.waitingReason ? (
                <p className="text-xs opacity-80">{stage.waitingReason}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
