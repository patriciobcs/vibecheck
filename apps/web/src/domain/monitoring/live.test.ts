import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import type { JevClient } from "@/providers/jev";
import { resetDb } from "@/test/db";
import { seedParticipant, seedStudy } from "@/test/fixtures";
import { claimAssignment } from "../assignments";
import { ingestEventBatch } from "../event-ingest";
import { recordConsent, startArchive, startRecording } from "../sessions";
import { createManualDetector } from "./detectors";
import { evaluateJob } from "./evaluate";
import { ingestObservationBatch, openObservationSession } from "./ingest";
import { liveBoard } from "./live";
import { setMonitoringPolicy } from "./policy";
import { scanJourney } from "./screening";

const questions = {
  evidence_sufficiency: {
    type: "choice" as const,
    instructions: "Enough context?",
    criteria: { sufficient: "a", partial: "b", insufficient: "c" },
  },
  ux_friction_observed: { type: "noul" as const, instructions: "Difficulty?" },
  targeted_research_warranted: { type: "noul" as const, instructions: "Study?" },
  problem_category: {
    type: "choice" as const,
    instructions: "Category",
    criteria: { discoverability: "a", other_or_uncertain: "b" },
  },
};
const answers = {
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
const jev: JevClient = {
  async evaluate() {
    return {
      model: "jev-1.13.0",
      answers,
      usage: { input_tokens: 400, output_tokens: 30 },
      requestId: "req_1",
    };
  },
};

beforeEach(resetDb);

describe("live board", () => {
  it("is empty and waiting until the first session, then lists sessions newest first", async () => {
    const { productId } = await seedStudy();
    const empty = await liveBoard(productId, null);
    expect(empty.sessions).toEqual([]);
    expect(empty.selected).toBeNull();
    expect(empty.product.policy.enabled).toBe(false);
  });

  it("shows a passive session's events, screening window, Jev answers and candidate", async () => {
    const { productId } = await seedStudy();
    await setMonitoringPolicy(
      productId,
      { enabled: true, allowed_journeys: ["share_drawing"], batch_delay_ms: 0 },
      null,
    );
    await createManualDetector({
      productId,
      detectorId: "share_drawing_export",
      journeyId: "share_drawing",
      appBuildRef: "b1",
      requiredEvents: ["journey_start", "help_request"],
      questions,
      sourceRefs: [],
    });
    const product = await db.query.products.findFirst();
    if (!product) throw new Error("product");
    const opened = await openObservationSession({
      publishableKey: product.publishableKey,
      origin: "https://app.example.test",
      buildRef: "b1",
      collectionPermission: "granted",
    });
    if (!opened.ok) throw new Error("open");
    const ev = (sequence: number, type: string) => ({
      event_id: `e${sequence}`,
      observation_session_id: opened.sessionId,
      journey_instance_id: "j1",
      journey_id: "share_drawing",
      sequence,
      t_ms: sequence * 1000,
      build_ref: "b1",
      instrumentation_schema_version: "1.0",
      collection_policy_ref: "cp",
      type,
      goal_source: "declared",
    });
    await ingestObservationBatch({
      sessionId: opened.sessionId,
      batch: {
        observation_session_id: opened.sessionId,
        batch_id: "b1",
        events: [ev(0, "journey_start"), ev(1, "help_request")],
      },
    });
    const listed = await liveBoard(productId, null);
    expect(listed.sessions).toMatchObject([
      { kind: "observation", id: opened.sessionId, events: 2, journeys: 1 },
    ]);

    await scanJourney({
      journeyInstanceId: "j1",
      observationSessionId: opened.sessionId,
      productId,
    });
    const evaluation = await db.query.jevEvaluations.findFirst();
    if (!evaluation) throw new Error("evaluation");
    await evaluateJob({ evaluationId: evaluation.id }, { jev, priceMicrosPer1k: null });

    const board = await liveBoard(productId, { kind: "observation", id: opened.sessionId });
    if (board.selected?.kind !== "observation") throw new Error("expected observation detail");
    expect(board.selected.events.map((e) => e.type)).toEqual(["journey_start", "help_request"]);
    expect(board.selected.evaluations).toHaveLength(1);
    const [done] = board.selected.evaluations;
    if (!done) throw new Error("evaluation missing");
    expect(done).toMatchObject({
      status: "completed",
      triggerReason: "help_request",
      returnedModel: "jev-1.13.0",
      inputTokens: 400,
      window: { events: 2, triggerReason: "help_request" },
    });
    // The redacted state that was sent to the model is reproducible from the immutable window.
    expect((done.state as { events: unknown[] }).events).toHaveLength(2);
    expect(done.answers).toMatchObject({ ux_friction_observed: { noul: 0.93 } });
    expect(board.selected.candidates).toMatchObject([
      { category: "discoverability", state: "proposed" },
    ]);
  });

  it("shows a study session with its semantic events, recording assets and transcript state", async () => {
    const { productId, studyId } = await seedStudy();
    const { participantId } = await seedParticipant();
    const claim = await claimAssignment({ studyId, participantId, channel: "embedded" });
    if (!claim.ok) throw new Error("claim");
    await recordConsent({ assignmentId: claim.assignment.id, participantId, consentVersion: "v1" });
    const media = {
      createSession: async () => ({ sessionId: "vsess" }),
      clientToken: () => "t",
      startArchive: async () => ({ archiveId: "arch_1" }),
      stopArchive: async () => {},
      getArchive: async () => {
        throw new Error("unused");
      },
    };
    const started = await startRecording({
      assignmentId: claim.assignment.id,
      participantId,
      media,
      instrumentation: "sdk",
      clientClockOriginMs: 0,
    });
    if (!started.ok) throw new Error("start");
    await startArchive({ assignmentId: claim.assignment.id, participantId, media, tMs: 0 });
    await ingestEventBatch({
      participantId,
      batch: {
        session_id: started.sessionId,
        batch_sequence: 0,
        events: [
          { session_id: started.sessionId, sequence: 0, t_ms: 10, type: "click" },
          {
            session_id: started.sessionId,
            sequence: 1,
            t_ms: 900,
            type: "semantic",
            semantic_type: "help_request",
            journey_id: "share_drawing",
            target_ref: "help",
          },
        ],
      },
    });
    const board = await liveBoard(productId, { kind: "study", id: started.sessionId });
    expect(board.sessions).toMatchObject([{ kind: "study", id: started.sessionId, events: 2 }]);
    if (board.selected?.kind !== "study") throw new Error("expected study detail");
    expect(board.selected.session).toMatchObject({
      state: "recording",
      transcriptStatus: "none",
    });
    expect(board.selected.events.map((e) => e.type)).toEqual(["click", "semantic"]);
    expect(board.selected.events[1]).toMatchObject({ semanticType: "help_request" });
    expect(board.selected.assets).toMatchObject([{ status: "recording" }]);
    expect(board.selected.transcript).toEqual([]);
  });
});
