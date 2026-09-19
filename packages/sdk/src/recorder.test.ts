import { describe, expect, it } from "vitest";
import { EventRecorder } from "./recorder";

function makeRecorder() {
  const sent: unknown[] = [];
  const recorder = new EventRecorder({
    sessionId: "session_1",
    clockOriginMs: 1000,
    now: () => 1500,
    send: async (batch) => {
      sent.push(batch);
    },
    flushIntervalMs: 0,
  });
  return { recorder, sent };
}

describe("EventRecorder", () => {
  it("records a click with a safe target and viewport, on the session clock", () => {
    const { recorder } = makeRecorder();
    document.body.innerHTML = '<button data-testid="book">Book now</button>';
    const button = document.querySelector("button") as HTMLButtonElement;
    recorder.onClick({ target: button, clientX: 10, clientY: 20 } as unknown as MouseEvent);
    expect(recorder.pending()).toEqual([
      expect.objectContaining({
        session_id: "session_1",
        sequence: 0,
        t_ms: 500,
        type: "click",
        safe_target_ref: "button[data-testid=book]",
        coordinates: { x: 10, y: 20 },
      }),
    ]);
  });

  it("records only semantic keys and never characters", () => {
    const { recorder } = makeRecorder();
    recorder.onKeyDown({ key: "a", target: document.body } as unknown as KeyboardEvent);
    recorder.onKeyDown({ key: "Enter", target: document.body } as unknown as KeyboardEvent);
    const types = recorder.pending().map((e) => [e.type, e.key]);
    expect(types).toEqual([["keydown", "Enter"]]);
  });

  it("counts edits in a field instead of capturing values", () => {
    const { recorder } = makeRecorder();
    document.body.innerHTML = '<input id="name" value="secret">';
    const input = document.querySelector("input") as HTMLInputElement;
    recorder.onInput({ target: input } as unknown as Event);
    recorder.onInput({ target: input } as unknown as Event);
    recorder.flushEditCounts();
    const ev = recorder.pending()[0];
    expect(ev).toMatchObject({ type: "edit_count", safe_target_ref: "input#name", count: 2 });
    expect(JSON.stringify(ev)).not.toContain("secret");
  });

  it("throttles pointer movement", () => {
    let t = 0;
    const recorder = new EventRecorder({
      sessionId: "s",
      clockOriginMs: 0,
      now: () => t,
      send: async () => {},
      flushIntervalMs: 0,
      pointerThrottleMs: 100,
    });
    for (t = 0; t < 1000; t += 10)
      recorder.onPointerMove({
        clientX: t,
        clientY: 0,
        target: document.body,
      } as unknown as MouseEvent);
    expect(recorder.pending().length).toBeLessThanOrEqual(11);
  });

  it("scrubs navigation URLs before queueing", () => {
    const { recorder } = makeRecorder();
    recorder.onNavigation(
      "https://app.example.test/reset/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG?code=1",
    );
    expect(recorder.pending()[0]).toMatchObject({
      type: "navigation",
      path: "https://app.example.test/reset/[token]",
    });
  });

  it("records host semantic events with allowlisted keys only, dropping free text", () => {
    const { recorder } = makeRecorder();
    recorder.semantic("action_result", {
      journey_id: "share_drawing",
      action_ref: "export_image",
      result: "success",
      note: "typed something",
    });
    recorder.semantic("not_a_type", { journey_id: "x" });
    expect(recorder.pending()).toEqual([
      expect.objectContaining({
        type: "semantic",
        semantic_type: "action_result",
        journey_id: "share_drawing",
        action_ref: "export_image",
        result: "success",
      }),
    ]);
    expect(recorder.pending()[0]).not.toHaveProperty("note");
  });

  it("sends batches with increasing batch_sequence and clears the queue", async () => {
    const { recorder, sent } = makeRecorder();
    recorder.onNavigation("https://a.test/1");
    await recorder.flush();
    recorder.onNavigation("https://a.test/2");
    await recorder.flush();
    expect(sent.map((b) => (b as { batch_sequence: number }).batch_sequence)).toEqual([0, 1]);
    expect(recorder.pending()).toEqual([]);
  });
});
