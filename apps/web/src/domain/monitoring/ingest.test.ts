import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/db/client";
import { resetDb } from "@/test/db";
import { seedStudy } from "@/test/fixtures";
import { ingestObservationBatch, openObservationSession } from "./ingest";
import { setMonitoringPolicy } from "./policy";

async function monitoredProduct() {
  const { productId, tenantId } = await seedStudy();
  await setMonitoringPolicy(
    productId,
    { enabled: true, allowed_journeys: ["share_drawing"] },
    null,
  );
  const product = await db.query.products.findFirst({ where: (p, { eq }) => eq(p.id, productId) });
  if (!product) throw new Error("product");
  return { productId, tenantId, key: product.publishableKey, origin: "https://app.example.test" };
}

const event = (
  session: string,
  sequence: number,
  type: string,
  extra: Record<string, unknown> = {},
) => ({
  event_id: `oev_${sequence}`,
  observation_session_id: session,
  journey_instance_id: "journey_1",
  journey_id: "share_drawing",
  sequence,
  t_ms: sequence * 1000,
  build_ref: "build_1",
  instrumentation_schema_version: "1.0",
  collection_policy_ref: "cp_1",
  type,
  goal_source: "declared",
  ...extra,
});

beforeEach(resetDb);

describe("passive observation ingestion", () => {
  it("refuses to open a session for a product whose monitoring is disabled", async () => {
    const { productId, key, origin } = await monitoredProduct();
    await setMonitoringPolicy(productId, { enabled: false }, null);
    expect(
      await openObservationSession({
        publishableKey: key,
        origin,
        buildRef: "b1",
        collectionPermission: "granted",
      }),
    ).toEqual({ ok: false, reason: "monitoring_disabled" });
  });

  it("refuses without a granted collection permission or from a non-permitted origin", async () => {
    const { key, origin } = await monitoredProduct();
    expect(
      await openObservationSession({
        publishableKey: key,
        origin,
        buildRef: "b1",
        collectionPermission: "unknown",
      }),
    ).toEqual({ ok: false, reason: "permission_not_granted" });
    expect(
      await openObservationSession({
        publishableKey: key,
        origin: "https://evil.example",
        buildRef: "b1",
        collectionPermission: "granted",
      }),
    ).toEqual({ ok: false, reason: "origin_not_permitted" });
  });

  it("stores events once, records gaps and receive time, and ignores journeys outside the policy", async () => {
    const { key, origin } = await monitoredProduct();
    const opened = await openObservationSession({
      publishableKey: key,
      origin,
      buildRef: "b1",
      collectionPermission: "granted",
    });
    if (!opened.ok) throw new Error("open");
    const batch = {
      observation_session_id: opened.sessionId,
      batch_id: "b1",
      events: [
        event(opened.sessionId, 0, "journey_start"),
        event(opened.sessionId, 2, "help_request"),
      ],
    };
    const r1 = await ingestObservationBatch({ sessionId: opened.sessionId, batch });
    const r2 = await ingestObservationBatch({ sessionId: opened.sessionId, batch });
    expect(r1).toMatchObject({
      ok: true,
      stored: 2,
      duplicate: false,
      gaps: [{ after_sequence: 0, missing: 1 }],
    });
    expect(r2).toMatchObject({ ok: true, stored: 0, duplicate: true });
    expect(await db.$count(schema.observationEvents)).toBe(2);
    const other = {
      ...batch,
      batch_id: "b2",
      events: [{ ...event(opened.sessionId, 3, "journey_start"), journey_id: "not_allowed" }],
    };
    expect(
      await ingestObservationBatch({ sessionId: opened.sessionId, batch: other }),
    ).toMatchObject({ ok: true, stored: 0, ignored: 1 });
  });

  it("rejects free text and oversized batches", async () => {
    const { key, origin } = await monitoredProduct();
    const opened = await openObservationSession({
      publishableKey: key,
      origin,
      buildRef: "b1",
      collectionPermission: "granted",
    });
    if (!opened.ok) throw new Error("open");
    const bad = {
      observation_session_id: opened.sessionId,
      batch_id: "b3",
      events: [{ ...event(opened.sessionId, 0, "journey_start"), text: "hello" }],
    };
    expect((await ingestObservationBatch({ sessionId: opened.sessionId, batch: bad })).ok).toBe(
      false,
    );
  });

  it("emits observation.batch_received once per batch and schedules a scan", async () => {
    const { key, origin } = await monitoredProduct();
    const opened = await openObservationSession({
      publishableKey: key,
      origin,
      buildRef: "b1",
      collectionPermission: "granted",
    });
    if (!opened.ok) throw new Error("open");
    await ingestObservationBatch({
      sessionId: opened.sessionId,
      batch: {
        observation_session_id: opened.sessionId,
        batch_id: "b1",
        events: [event(opened.sessionId, 0, "journey_start")],
      },
    });
    const events = await db.query.eventOutbox.findMany();
    expect(events.map((e) => e.eventType)).toEqual(["observation.batch_received"]);
    const jobs = await db.query.jobs.findMany();
    expect(jobs.map((j) => j.type)).toEqual(["monitoring.scan"]);
    expect(jobs[0]?.nextRunAt.getTime()).toBeGreaterThan(Date.now() + 3000);
  });
});
