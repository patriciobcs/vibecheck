import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/db/client";
import { type JevClient, JevProviderError } from "@/providers/jev";
import { resetDb } from "@/test/db";
import { seedStudy } from "@/test/fixtures";
import { dismissCandidate } from "./candidates";
import { createManualDetector } from "./detectors";
import { evaluateJob } from "./evaluate";
import { ingestObservationBatch, openObservationSession } from "./ingest";
import { setMonitoringPolicy } from "./policy";
import { retryDeferredEvaluations, scanJourney, sweepIdleJourneys } from "./screening";

const questions = {
  evidence_sufficiency: {
    type: "choice" as const,
    instructions: "Enough context?",
    criteria: { sufficient: "a", partial: "b", insufficient: "c" },
  },
  ux_friction_observed: {
    type: "noul" as const,
    instructions: "Difficulty?",
    criteria: { true: "x", false: "y" },
  },
  targeted_research_warranted: { type: "noul" as const, instructions: "Study?" },
  problem_category: {
    type: "choice" as const,
    instructions: "Category",
    criteria: { discoverability: "a", other_or_uncertain: "b" },
  },
};

const answersFriction = {
  evidence_sufficiency: {
    type: "choice",
    choice: "partial",
    confidence: 0.7,
    probabilities: { partial: 0.7, sufficient: 0.2, insufficient: 0.1 },
  },
  ux_friction_observed: { type: "noul", noul: 0.93 },
  targeted_research_warranted: { type: "noul", noul: 0.88 },
  problem_category: {
    type: "choice",
    choice: "discoverability",
    confidence: 0.8,
    probabilities: { discoverability: 0.8, other_or_uncertain: 0.2 },
  },
};

function jev(answers: unknown = answersFriction): JevClient & { calls: number } {
  const client = {
    calls: 0,
    async evaluate() {
      client.calls += 1;
      return {
        model: "jev-1.13.0",
        answers: answers as Record<string, unknown>,
        usage: { input_tokens: 500, output_tokens: 30 },
        requestId: `req_${client.calls}`,
      };
    },
  };
  return client;
}

async function setup() {
  const { productId } = await seedStudy();
  await setMonitoringPolicy(
    productId,
    { enabled: true, allowed_journeys: ["share_drawing"], batch_delay_ms: 0, cooldown_ms: 30_000 },
    null,
  );
  await createManualDetector({
    productId,
    detectorId: "share_drawing_export",
    journeyId: "share_drawing",
    appBuildRef: "build_1",
    requiredEvents: ["journey_start", "help_request"],
    questions,
    sourceRefs: [],
  });
  const product = await db.query.products.findFirst({ where: (p, { eq }) => eq(p.id, productId) });
  if (!product) throw new Error("product");
  const opened = await openObservationSession({
    publishableKey: product.publishableKey,
    origin: "https://app.example.test",
    buildRef: "build_1",
    collectionPermission: "granted",
  });
  if (!opened.ok) throw new Error("open");
  return { productId, sessionId: opened.sessionId };
}

const seqBase = (journey: string) =>
  journey === "journey_1" ? 0 : journey === "journey_2" ? 100 : 900;
const ev = (
  session: string,
  sequence: number,
  type: string,
  extra: Record<string, unknown> = {},
  journey = "journey_1",
) => ({
  event_id: `oev_${journey}_${sequence}`,
  observation_session_id: session,
  journey_instance_id: journey,
  journey_id: "share_drawing",
  sequence: seqBase(journey) + sequence,
  t_ms: (seqBase(journey) + sequence) * 1000,
  build_ref: "build_1",
  instrumentation_schema_version: "1.0",
  collection_policy_ref: "cp",
  type,
  goal_source: "declared",
  ...extra,
});

async function helpJourney(sessionId: string, journey = "journey_1", batchId = "b1") {
  await ingestObservationBatch({
    sessionId,
    batch: {
      observation_session_id: sessionId,
      batch_id: batchId,
      events: [
        ev(sessionId, 0, "journey_start", {}, journey),
        ev(sessionId, 1, "help_request", {}, journey),
      ],
    },
  });
}

beforeEach(resetDb);

describe("screening", () => {
  it("a help request creates exactly one queued evaluation for the window, with a reservation", async () => {
    const { productId, sessionId } = await setup();
    await helpJourney(sessionId);
    const a = await scanJourney({
      journeyInstanceId: "journey_1",
      observationSessionId: sessionId,
      productId,
    });
    const b = await scanJourney({
      journeyInstanceId: "journey_1",
      observationSessionId: sessionId,
      productId,
    });
    expect(a.map((r) => r.action)).toEqual(["evaluation_queued"]);
    expect(b.map((r) => r.action)).toEqual(["unchanged_window"]);
    expect(await db.$count(schema.jevEvaluations)).toBe(1);
    expect(await db.$count(schema.evaluationReservations)).toBe(1);
    expect((await db.query.jobs.findMany()).map((j) => j.type)).toContain("jev.evaluate");
  });

  it("defers instead of calling the model when required telemetry is missing", async () => {
    const { productId, sessionId } = await setup();
    await createManualDetector({
      productId,
      detectorId: "needs_completion",
      journeyId: "share_drawing",
      appBuildRef: "build_1",
      requiredEvents: ["journey_start", "completion", "progress"],
      questions,
      sourceRefs: [],
    });
    await ingestObservationBatch({
      sessionId,
      batch: {
        observation_session_id: sessionId,
        batch_id: "b1",
        events: [ev(sessionId, 0, "journey_start"), ev(sessionId, 1, "help_request")],
      },
    });
    const results = await scanJourney({
      journeyInstanceId: "journey_1",
      observationSessionId: sessionId,
      productId,
    });
    const deferred = results.find((r) => r.detectorId === "needs_completion");
    expect(deferred?.action).toBe("deferred");
    expect(deferred?.reason).toMatch(/needs_instrumentation/);
  });

  it("scopes a journey to its observation session when another session reuses instance and event ids", async () => {
    const { productId, sessionId } = await setup();
    const product = await db.query.products.findFirst({
      where: (p, { eq }) => eq(p.id, productId),
    });
    if (!product) throw new Error("product");
    const other = await openObservationSession({
      publishableKey: product.publishableKey,
      origin: "https://app.example.test",
      buildRef: "build_1",
      collectionPermission: "granted",
    });
    if (!other.ok) throw new Error("open");
    await helpJourney(sessionId);
    await helpJourney(other.sessionId);
    // Same client event ids in two sessions are two distinct rows.
    expect(await db.$count(schema.observationEvents)).toBe(4);
    const scans = (await db.query.jobs.findMany()).filter((j) => j.type === "monitoring.scan");
    expect(scans).toHaveLength(2);

    const a = await scanJourney({
      journeyInstanceId: "journey_1",
      observationSessionId: sessionId,
      productId,
    });
    const b = await scanJourney({
      journeyInstanceId: "journey_1",
      observationSessionId: other.sessionId,
      productId,
    });
    expect(a.map((r) => r.action)).toEqual(["evaluation_queued"]);
    expect(b.map((r) => r.action)).toEqual(["evaluation_queued"]);
    const windows = await db.query.observationWindows.findMany();
    expect(windows).toHaveLength(2);
    for (const w of windows) {
      const own = (
        await db.query.observationEvents.findMany({
          where: eq(schema.observationEvents.observationSessionId, w.observationSessionId),
        })
      ).map((e) => e.id);
      expect(w.eventIds).toHaveLength(2);
      expect(w.eventIds.every((id) => own.includes(id))).toBe(true);
    }
  });

  it("re-queues a budget-deferred evaluation once the cap frees instead of dropping the window", async () => {
    const { productId, sessionId } = await setup();
    await setMonitoringPolicy(productId, { max_evaluations_per_product_day: 1 }, null);
    await helpJourney(sessionId, "journey_1", "b1");
    await helpJourney(sessionId, "journey_2", "b2");
    const scan = (journeyInstanceId: string) =>
      scanJourney({ journeyInstanceId, observationSessionId: sessionId, productId });
    expect((await scan("journey_1")).map((r) => r.action)).toEqual(["evaluation_queued"]);
    expect(await scan("journey_2")).toMatchObject([
      { action: "deferred", reason: "product_day_cap" },
    ]);
    // Same day, same window: still deferred, never silently "unchanged".
    expect(await scan("journey_2")).toMatchObject([
      { action: "deferred", reason: "product_day_cap" },
    ]);
    expect(await db.$count(schema.jevEvaluations)).toBe(2);

    const tomorrow = new Date(Date.now() + 24 * 60 * 60_000);
    const retried = await retryDeferredEvaluations(tomorrow);
    expect(retried.map((r) => r.action)).toEqual(["evaluation_queued"]);
    const queued = await db.query.jevEvaluations.findMany({
      where: eq(schema.jevEvaluations.status, "queued"),
    });
    expect(queued).toHaveLength(2);
    expect(queued.every((e) => e.reservationId)).toBe(true);
    const jobs = (await db.query.jobs.findMany()).filter((j) => j.type === "jev.evaluate");
    expect(jobs).toHaveLength(2);
  });

  it("does nothing when monitoring is disabled or the tenant is paused", async () => {
    const { productId, sessionId } = await setup();
    await helpJourney(sessionId);
    await setMonitoringPolicy(productId, { enabled: false }, null);
    expect(
      await scanJourney({
        journeyInstanceId: "journey_1",
        observationSessionId: sessionId,
        productId,
      }),
    ).toEqual([{ action: "skipped", reason: "monitoring_disabled" }]);
  });

  it("the sweep evaluates a journey that went silent for five minutes as an unknown-outcome end", async () => {
    const { sessionId } = await setup();
    await ingestObservationBatch({
      sessionId,
      batch: {
        observation_session_id: sessionId,
        batch_id: "b1",
        events: [
          ev(sessionId, 0, "journey_start"),
          ev(sessionId, 1, "progress", { progress_ref: "p" }),
        ],
      },
    });
    await db
      .update(schema.observationSessions)
      .set({ lastEventAt: new Date(Date.now() - 6 * 60_000) });
    await db
      .update(schema.observationEvents)
      .set({ receivedAt: new Date(Date.now() - 6 * 60_000) });
    const swept = await sweepIdleJourneys();
    expect(swept.length).toBeGreaterThan(0);
    const evals = await db.query.jevEvaluations.findMany();
    expect(evals.map((e) => e.triggerReason)).toEqual(["journey_end"]);
  });
});

describe("evaluation and candidates", () => {
  it("completes an evaluation, reconciles usage, and creates a research candidate above thresholds", async () => {
    const { productId, sessionId } = await setup();
    await helpJourney(sessionId);
    await scanJourney({
      journeyInstanceId: "journey_1",
      observationSessionId: sessionId,
      productId,
    });
    const evaluation = await db.query.jevEvaluations.findFirst();
    if (!evaluation) throw new Error("evaluation");
    const client = jev();
    await evaluateJob({ evaluationId: evaluation.id }, { jev: client, priceMicrosPer1k: null });
    await evaluateJob({ evaluationId: evaluation.id }, { jev: client, priceMicrosPer1k: null });
    expect(client.calls).toBe(1);
    const done = await db.query.jevEvaluations.findFirst();
    expect(done).toMatchObject({
      status: "completed",
      returnedModel: "jev-1.13.0",
      inputTokens: 500,
      providerRequestId: "req_1",
      estimatedCostMicros: null,
    });
    const candidates = await db.query.researchCandidates.findMany();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      journeyId: "share_drawing",
      category: "discoverability",
      state: "proposed",
      distinctObservationSessions: 1,
      distinctJourneyInstances: 1,
      latestFrictionPermille: 930,
    });
    expect(candidates[0]?.evidenceLimitations.join(" ")).toMatch(/partial/);
    expect((await db.query.eventOutbox.findMany()).map((e) => e.eventType)).toContain(
      "research_candidate.updated",
    );
  });

  it("keeps the budget reservation across a transient provider failure and reconciles once", async () => {
    const { productId, sessionId } = await setup();
    const price = { input: 3000, output: 15000 };
    await helpJourney(sessionId);
    await scanJourney({
      journeyInstanceId: "journey_1",
      observationSessionId: sessionId,
      productId,
      priceMicrosPer1k: price,
    });
    const evaluation = await db.query.jevEvaluations.findFirst();
    if (!evaluation) throw new Error("evaluation");
    expect(evaluation.reservationId).toBeTruthy();
    expect(evaluation.reservedMicros).toBeGreaterThan(0);
    expect((await db.query.evaluationBudgetLedger.findFirst())?.estimatedCostMicros).toBe(
      evaluation.reservedMicros,
    );

    let calls = 0;
    const flaky: JevClient = {
      async evaluate() {
        calls += 1;
        if (calls === 1) throw new JevProviderError("rate_limited", 429, true, "");
        return {
          model: "jev-1.13.0",
          answers: answersFriction as Record<string, unknown>,
          usage: { input_tokens: 500, output_tokens: 30 },
          requestId: "req_2",
        };
      },
    };
    await expect(
      evaluateJob({ evaluationId: evaluation.id }, { jev: flaky, priceMicrosPer1k: price }),
    ).rejects.toBeInstanceOf(JevProviderError);
    expect((await db.query.jevEvaluations.findFirst())?.status).toBe("queued");
    await evaluateJob({ evaluationId: evaluation.id }, { jev: flaky, priceMicrosPer1k: price });
    const ledger = await db.query.evaluationBudgetLedger.findFirst();
    expect(ledger?.estimatedCostMicros).toBe(Math.round((500 * 3000) / 1000 + (30 * 15000) / 1000));
    expect(ledger?.evaluations).toBe(1);
  });

  it("low scores or insufficient evidence produce no candidate, and malformed answers fail the evaluation", async () => {
    const { productId, sessionId } = await setup();
    await helpJourney(sessionId);
    await scanJourney({
      journeyInstanceId: "journey_1",
      observationSessionId: sessionId,
      productId,
    });
    const evaluation = await db.query.jevEvaluations.findFirst();
    if (!evaluation) throw new Error("evaluation");
    await evaluateJob(
      { evaluationId: evaluation.id },
      {
        jev: jev({
          ...answersFriction,
          evidence_sufficiency: {
            type: "choice",
            choice: "insufficient",
            confidence: 0.9,
            probabilities: {},
          },
        }),
        priceMicrosPer1k: null,
      },
    );
    expect(await db.$count(schema.researchCandidates)).toBe(0);
    expect((await db.query.jevEvaluations.findFirst())?.status).toBe("completed");

    await helpJourney(sessionId, "journey_2", "b2");
    await db.update(schema.jevEvaluations).set({ requestedAt: new Date(Date.now() - 60_000) });
    await scanJourney({
      journeyInstanceId: "journey_2",
      observationSessionId: sessionId,
      productId,
    });
    const second = (await db.query.jevEvaluations.findMany()).find((e) => e.status === "queued");
    if (!second) throw new Error("second evaluation");
    await expect(
      evaluateJob(
        { evaluationId: second.id },
        { jev: jev({ ux_friction_observed: { type: "noul", noul: 2 } }), priceMicrosPer1k: null },
      ),
    ).rejects.toThrow();
    expect((await db.query.jevEvaluations.findMany()).find((e) => e.id === second.id)?.status).toBe(
      "failed",
    );
  });

  it("groups repeated signals into one candidate counting distinct sessions, and dismissal keeps provenance", async () => {
    const { productId, sessionId } = await setup();
    await helpJourney(sessionId, "journey_1", "b1");
    await scanJourney({
      journeyInstanceId: "journey_1",
      observationSessionId: sessionId,
      productId,
    });
    const first = await db.query.jevEvaluations.findFirst();
    if (!first) throw new Error("first");
    await evaluateJob({ evaluationId: first.id }, { jev: jev(), priceMicrosPer1k: null });
    // Second session, same journey/category/build.
    const product = await db.query.products.findFirst({
      where: (p, { eq }) => eq(p.id, productId),
    });
    const opened = await openObservationSession({
      publishableKey: product?.publishableKey ?? "",
      origin: "https://app.example.test",
      buildRef: "build_1",
      collectionPermission: "granted",
    });
    if (!opened.ok) throw new Error("open2");
    await helpJourney(opened.sessionId, "journey_9", "b9");
    await scanJourney({
      journeyInstanceId: "journey_9",
      observationSessionId: opened.sessionId,
      productId,
    });
    const second = (await db.query.jevEvaluations.findMany()).find((e) => e.status === "queued");
    if (!second) throw new Error("second");
    await evaluateJob({ evaluationId: second.id }, { jev: jev(), priceMicrosPer1k: null });
    const candidates = await db.query.researchCandidates.findMany();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      distinctObservationSessions: 2,
      distinctJourneyInstances: 2,
    });
    expect(candidates[0]?.evaluationRefs).toHaveLength(2);
    const dismissed = await dismissCandidate(candidates[0]?.id ?? "", "not actionable", "user_1");
    expect(dismissed?.state).toBe("dismissed");
    expect(dismissed?.evaluationRefs).toHaveLength(2);
  });
});
