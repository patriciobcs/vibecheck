import { scrubUrl } from "@vibecheck/contracts/safe";

/** Allowlisted semantic event types (mirrors contracts; kept dependency-free for the bundle). */
const TYPES = new Set([
  "journey_start",
  "progress",
  "action_attempt",
  "action_result",
  "validation_error",
  "navigation",
  "help_request",
  "completion",
  "exit",
  "visibility",
]);
/** Allowlisted payload keys per event. Anything else is dropped before it reaches the queue. */
const KEYS = new Set([
  "journey_id",
  "action_ref",
  "attempt_id",
  "result",
  "error_code",
  "progress_ref",
  "route_template",
  "target_ref",
  "verification",
  "visible",
  "goal_source",
]);

export type ObservationEvent = {
  event_id: string;
  observation_session_id: string;
  journey_instance_id: string;
  journey_id: string;
  sequence: number;
  t_ms: number;
  build_ref: string;
  instrumentation_schema_version: string;
  collection_policy_ref: string;
  type: string;
  goal_source: "declared" | "inferred" | "unknown";
  [key: string]: unknown;
};

export type ObservationBatch = {
  observation_session_id: string;
  batch_id: string;
  events: ObservationEvent[];
};

export type ObserverOptions = {
  observationSessionId: string;
  buildRef: string;
  collectionPolicyRef: string;
  clockOriginMs: number;
  send: (batch: ObservationBatch) => Promise<void>;
  now?: () => number;
  flushIntervalMs?: number;
  maxBatch?: number;
  maxQueue?: number;
  instrumentationSchemaVersion?: string;
};

const rand = () => Math.random().toString(36).slice(2, 10);

/**
 * Passive semantic telemetry (VC-02 passive observation mode). Independent of the recorder:
 * nothing is queued until the host reports collection permission, collection is suppressed while a
 * research assignment is active, and withdrawing permission clears unsent buffers.
 */
export class Observer {
  private permitted = false;
  private researchActive = false;
  private queue: ObservationEvent[] = [];
  private sequence = 0;
  private droppedCount = 0;
  private journeyInstanceId: string | null = null;
  private journeyId: string | null = null;
  private inflight: ObservationBatch | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;

  constructor(private readonly opts: ObserverOptions) {
    this.now = opts.now ?? (() => Date.now());
    if (opts.flushIntervalMs && opts.flushIntervalMs > 0)
      this.timer = setInterval(() => void this.flush(), opts.flushIntervalMs);
  }

  setCollectionPermission(granted: boolean) {
    this.permitted = granted;
    if (!granted) {
      this.queue = [];
      this.inflight = null;
    }
  }

  setResearchActive(active: boolean) {
    this.researchActive = active;
  }

  pending(): ObservationEvent[] {
    return [...(this.inflight?.events ?? []), ...this.queue];
  }

  dropped(): number {
    return this.droppedCount;
  }

  /** Public API for host apps: `VibeCheck.track("action_result", { action_ref, result })`. */
  track(type: string, payload: Record<string, unknown> = {}) {
    if (!this.permitted || this.researchActive || !TYPES.has(type)) return;
    if (type === "journey_start") {
      const journeyId = typeof payload.journey_id === "string" ? payload.journey_id : null;
      if (!journeyId) return;
      this.journeyInstanceId = `journey_${rand()}${rand()}`;
      this.journeyId = journeyId;
    }
    if (!this.journeyInstanceId || !this.journeyId) return; // events outside a journey are not collected
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload))
      if (KEYS.has(k) && (typeof v === "string" || typeof v === "boolean")) safe[k] = v;
    const event: ObservationEvent = {
      event_id: `oev_${rand()}${rand()}`,
      observation_session_id: this.opts.observationSessionId,
      journey_instance_id: this.journeyInstanceId,
      journey_id: this.journeyId,
      sequence: this.sequence++,
      t_ms: Math.max(0, Math.round(this.now() - this.opts.clockOriginMs)),
      build_ref: this.opts.buildRef,
      instrumentation_schema_version: this.opts.instrumentationSchemaVersion ?? "1.0",
      collection_policy_ref: this.opts.collectionPolicyRef,
      type,
      goal_source:
        (safe.goal_source as ObservationEvent["goal_source"]) ??
        (type === "journey_start" ? "declared" : "unknown"),
      ...safe,
    };
    if (type === "completion" || type === "exit") {
      this.queue.push(event);
      this.journeyInstanceId = null;
      this.journeyId = null;
    } else {
      this.queue.push(event);
    }
    const max = this.opts.maxQueue ?? 500;
    if (this.queue.length > max) {
      this.droppedCount += this.queue.length - max;
      this.queue.splice(0, this.queue.length - max);
    }
  }

  onNavigation(url: string) {
    let route = "/";
    try {
      const scrubbed = scrubUrl(url);
      route = scrubbed === "invalid" ? "/" : new URL(scrubbed).pathname;
    } catch {}
    this.track("navigation", { route_template: route });
  }

  onVisibility(visible: boolean) {
    this.track("visibility", { visible });
  }

  async flush(): Promise<void> {
    if (!this.permitted) return;
    if (!this.inflight) {
      if (this.queue.length === 0) return;
      const events = this.queue.splice(0, this.opts.maxBatch ?? 100);
      this.inflight = {
        observation_session_id: this.opts.observationSessionId,
        batch_id: `obatch_${rand()}${rand()}`,
        events,
      };
    }
    try {
      await this.opts.send(this.inflight);
      this.inflight = null;
    } catch {
      // keep the same batch id and sequence numbers; the server deduplicates on retry
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
