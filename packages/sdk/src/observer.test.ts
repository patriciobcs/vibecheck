import { describe, expect, it } from "vitest";
import { Observer } from "./observer";

function make(overrides: Partial<ConstructorParameters<typeof Observer>[0]> = {}) {
  const sent: unknown[] = [];
  let t = 10_000;
  const observer = new Observer({
    observationSessionId: "obs_1",
    buildRef: "build_1",
    collectionPolicyRef: "cp_1",
    clockOriginMs: 0,
    now: () => t,
    send: async (batch) => {
      sent.push(batch);
    },
    flushIntervalMs: 0,
    ...overrides,
  });
  return { observer, sent, tick: (ms: number) => (t += ms) };
}

describe("Observer (passive semantic telemetry)", () => {
  it("does nothing until collection permission is granted", () => {
    const { observer } = make();
    observer.track("journey_start", { journey_id: "share_drawing" });
    expect(observer.pending()).toEqual([]);
    observer.setCollectionPermission(true);
    observer.track("journey_start", { journey_id: "share_drawing" });
    expect(observer.pending()).toHaveLength(1);
  });

  it("assigns a journey instance on journey_start and attaches it to later events", () => {
    const { observer } = make();
    observer.setCollectionPermission(true);
    observer.track("journey_start", { journey_id: "share_drawing" });
    observer.track("action_result", { action_ref: "export_image", result: "success" });
    const [start, result] = observer.pending();
    expect(start?.journey_instance_id).toBeTruthy();
    expect(result?.journey_instance_id).toBe(start?.journey_instance_id);
    expect(result?.journey_id).toBe("share_drawing");
    expect(result?.sequence).toBe(1);
  });

  it("drops unknown properties and free text so nothing sensitive can be sent", () => {
    const { observer } = make();
    observer.setCollectionPermission(true);
    observer.track("journey_start", { journey_id: "j" });
    observer.track("action_result", {
      action_ref: "save",
      result: "failed",
      error_code: "E1",
      text: "my password",
      value: "x",
    } as never);
    const ev = observer.pending()[1] as Record<string, unknown>;
    expect(ev.text).toBeUndefined();
    expect(ev.value).toBeUndefined();
    expect(ev.error_code).toBe("E1");
  });

  it("scrubs navigation to a route template without query strings", () => {
    const { observer } = make();
    observer.setCollectionPermission(true);
    observer.onNavigation("https://app.test/ignored-outside-a-journey");
    expect(observer.pending()).toEqual([]); // navigation alone cannot establish a goal: no journey, no event
    observer.track("journey_start", { journey_id: "j" });
    observer.onNavigation(
      "https://app.test/boards/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG?x=1",
    );
    expect(observer.pending()[1]).toMatchObject({
      type: "navigation",
      route_template: "/boards/[token]",
    });
  });

  it("suppresses collection while a research session is active and clears unsent events on withdrawal", () => {
    const { observer } = make();
    observer.setCollectionPermission(true);
    observer.track("journey_start", { journey_id: "j" });
    observer.setResearchActive(true);
    observer.track("help_request", {});
    expect(observer.pending()).toHaveLength(1);
    observer.setCollectionPermission(false);
    expect(observer.pending()).toEqual([]);
  });

  it("flushes stable batches with ids and retries without renumbering", async () => {
    let fail = true;
    const sent: { batch_id: string }[] = [];
    const { observer } = make({
      send: async (batch) => {
        if (fail) throw new Error("offline");
        sent.push(batch as { batch_id: string });
      },
    });
    observer.setCollectionPermission(true);
    observer.track("journey_start", { journey_id: "j" });
    await observer.flush();
    expect(sent).toEqual([]);
    expect(observer.pending()).toHaveLength(1);
    fail = false;
    await observer.flush();
    expect(sent).toHaveLength(1);
    expect(observer.pending()).toEqual([]);
  });

  it("bounds the queue and records dropped coverage", () => {
    const { observer } = make({ maxQueue: 5 });
    observer.setCollectionPermission(true);
    observer.track("journey_start", { journey_id: "j" });
    for (let i = 0; i < 10; i += 1) observer.track("progress", { progress_ref: `p${i}` });
    expect(observer.pending().length).toBeLessThanOrEqual(5);
    expect(observer.dropped()).toBeGreaterThan(0);
  });
});
