import { safeTargetRef, scrubUrl } from "@vibecheck/contracts/safe";

/** Keys the SDK may report (mirrors contracts SEMANTIC_KEYS without pulling zod into the bundle). */
const SEMANTIC_KEYS = new Set([
  "Tab",
  "Enter",
  "Escape",
  "Backspace",
  "Delete",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

export type RecordedEvent = {
  session_id: string;
  sequence: number;
  t_ms: number;
  type: string;
  safe_target_ref?: string;
  viewport?: { width: number; height: number };
  coordinates?: { x: number; y: number };
  path?: string;
  key?: string;
  count?: number;
  label?: string;
};

export type EventBatch = { session_id: string; batch_sequence: number; events: RecordedEvent[] };

export type RecorderOptions = {
  sessionId: string;
  /** Epoch ms that maps to t_ms = 0 (shared with the recorder page). */
  clockOriginMs: number;
  send: (batch: EventBatch) => Promise<void>;
  now?: () => number;
  flushIntervalMs?: number;
  pointerThrottleMs?: number;
  maxBatch?: number;
};

function targetInfo(el: EventTarget | null) {
  if (!(el instanceof Element)) return null;
  const tag = el.tagName.toLowerCase();
  const isControl = tag === "input" || tag === "textarea" || tag === "select";
  return {
    tag,
    testId: el.getAttribute("data-testid"),
    id: el.id || null,
    role: el.getAttribute("role"),
    // Never read text of form controls; short labels only for buttons/links.
    text: isControl ? null : (el.textContent ?? "").slice(0, 80),
  };
}

/**
 * Collects safe interaction events on instrumented pages (VC-02 "Recording configuration").
 * No typed characters, clipboard data, input values or password content ever enter the queue.
 */
export class EventRecorder {
  private queue: RecordedEvent[] = [];
  private sequence = 0;
  private batchSequence = 0;
  private lastPointerAt = Number.NEGATIVE_INFINITY;
  private editCounts = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;
  private readonly pointerThrottleMs: number;
  private readonly maxBatch: number;

  constructor(private readonly opts: RecorderOptions) {
    this.now = opts.now ?? (() => Date.now());
    this.pointerThrottleMs = opts.pointerThrottleMs ?? 100;
    this.maxBatch = opts.maxBatch ?? 200;
    if (opts.flushIntervalMs && opts.flushIntervalMs > 0) {
      this.timer = setInterval(() => void this.flush(), opts.flushIntervalMs);
    }
  }

  pending(): RecordedEvent[] {
    return [...this.queue];
  }

  private tMs(): number {
    return Math.max(0, Math.round(this.now() - this.opts.clockOriginMs));
  }

  private viewport() {
    if (typeof window === "undefined") return undefined;
    return { width: window.innerWidth, height: window.innerHeight };
  }

  private push(ev: Omit<RecordedEvent, "session_id" | "sequence" | "t_ms">) {
    this.queue.push({
      session_id: this.opts.sessionId,
      sequence: this.sequence++,
      t_ms: this.tMs(),
      ...ev,
    });
    if (this.queue.length >= this.maxBatch) void this.flush();
  }

  onClick(e: MouseEvent) {
    const info = targetInfo(e.target);
    this.push({
      type: "click",
      safe_target_ref: info ? safeTargetRef(info) : undefined,
      coordinates: { x: Math.round(e.clientX), y: Math.round(e.clientY) },
      viewport: this.viewport(),
    });
  }

  onPointerMove(e: MouseEvent) {
    const t = this.now();
    if (t - this.lastPointerAt < this.pointerThrottleMs) return;
    this.lastPointerAt = t;
    this.push({
      type: "pointer_move",
      coordinates: { x: Math.round(e.clientX), y: Math.round(e.clientY) },
      viewport: this.viewport(),
    });
  }

  onScroll() {
    if (typeof window === "undefined") return;
    this.push({
      type: "scroll",
      coordinates: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
      viewport: this.viewport(),
    });
  }

  onKeyDown(e: KeyboardEvent) {
    if (!SEMANTIC_KEYS.has(e.key)) return;
    const info = targetInfo(e.target);
    this.push({
      type: "keydown",
      key: e.key,
      safe_target_ref: info ? safeTargetRef(info) : undefined,
    });
  }

  /** Counts edits per field; flushed as edit_count events. Values are never read. */
  onInput(e: Event) {
    const info = targetInfo(e.target);
    const ref = info ? safeTargetRef(info) : "unknown";
    this.editCounts.set(ref, (this.editCounts.get(ref) ?? 0) + 1);
  }

  flushEditCounts() {
    for (const [ref, count] of this.editCounts)
      this.push({ type: "edit_count", safe_target_ref: ref, count });
    this.editCounts.clear();
  }

  onFocus(hasFocus: boolean) {
    this.push({ type: hasFocus ? "focus" : "blur" });
  }

  onVisibility(visible: boolean) {
    this.push({ type: "visibility", label: undefined, count: visible ? 1 : 0 });
  }

  onNavigation(url: string) {
    this.push({ type: "navigation", path: scrubUrl(url), viewport: this.viewport() });
  }

  async flush(): Promise<void> {
    this.flushEditCounts();
    if (this.queue.length === 0) return;
    const events = this.queue.splice(0, this.queue.length);
    const batch: EventBatch = {
      session_id: this.opts.sessionId,
      batch_sequence: this.batchSequence++,
      events,
    };
    try {
      await this.opts.send(batch);
    } catch {
      // Put the events back at the front so ordering and sequence numbers stay intact.
      this.queue.unshift(...events);
      this.batchSequence -= 1;
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
