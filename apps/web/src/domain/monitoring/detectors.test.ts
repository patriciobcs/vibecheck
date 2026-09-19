import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/db/client";
import type { DetectorGenerator } from "@/providers/detector-generation/types";
import { resetDb } from "@/test/db";
import { seedStudy } from "@/test/fixtures";
import {
  activeDetectorsForJourney,
  createManualDetector,
  generateDetector,
  markDetectorsStaleForBuild,
} from "./detectors";

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

beforeEach(resetDb);

describe("detectors", () => {
  it("creates an active, immutable, versioned manual detector and rejects invalid questions", async () => {
    const { productId } = await seedStudy();
    const d1 = await createManualDetector({
      productId,
      detectorId: "share_drawing_export",
      journeyId: "share_drawing",
      appBuildRef: "build_1",
      requiredEvents: ["journey_start", "completion"],
      questions,
      sourceRefs: ["manual"],
    });
    expect(d1.ok && d1.detector.version === 1 && d1.detector.status === "active").toBe(true);
    const d2 = await createManualDetector({
      productId,
      detectorId: "share_drawing_export",
      journeyId: "share_drawing",
      appBuildRef: "build_1",
      requiredEvents: ["journey_start"],
      questions,
      sourceRefs: [],
    });
    expect(d2.ok && d2.detector.version).toBe(2);
    const { problem_category: _p, ...bad } = questions;
    const d3 = await createManualDetector({
      productId,
      detectorId: "x",
      journeyId: "j",
      appBuildRef: "b",
      requiredEvents: ["journey_start"],
      questions: bad,
      sourceRefs: [],
    });
    expect(d3.ok).toBe(false);
    expect(await db.$count(schema.detectorDefinitions)).toBe(2);
    expect((await db.query.eventOutbox.findMany()).map((e) => e.eventType)).toEqual([
      "detector.published",
      "detector.published",
    ]);
  });

  it("returns only the latest active version per detector for a journey and build", async () => {
    const { productId } = await seedStudy();
    await createManualDetector({
      productId,
      detectorId: "d",
      journeyId: "j",
      appBuildRef: "b1",
      requiredEvents: ["journey_start"],
      questions,
      sourceRefs: [],
    });
    await createManualDetector({
      productId,
      detectorId: "d",
      journeyId: "j",
      appBuildRef: "b1",
      requiredEvents: ["journey_start"],
      questions,
      sourceRefs: [],
    });
    const active = await activeDetectorsForJourney(productId, "j", "b1");
    expect(active.map((d) => d.version)).toEqual([2]);
  });

  it("marks detectors stale when a new build appears instead of applying them silently", async () => {
    const { productId } = await seedStudy();
    await createManualDetector({
      productId,
      detectorId: "d",
      journeyId: "j",
      appBuildRef: "b1",
      requiredEvents: ["journey_start"],
      questions,
      sourceRefs: [],
    });
    const stale = await markDetectorsStaleForBuild(productId, "b2");
    expect(stale).toBe(1);
    expect(await activeDetectorsForJourney(productId, "j", "b2")).toEqual([]);
    expect((await db.query.detectorDefinitions.findFirst())?.status).toBe("stale");
  });

  it("generated detectors go through validation; missing instrumentation yields needs_instrumentation", async () => {
    const { productId } = await seedStudy();
    const generator: DetectorGenerator = {
      name: "test",
      generate: async () => ({
        raw: {
          schema_version: "1.0",
          journey_id: "share_drawing",
          required_events: ["journey_start", "action_result", "completion"],
          missing_instrumentation: ["completion"],
          questions,
          rationale: "r",
        },
        handle: {},
      }),
    };
    const res = await generateDetector(
      { productId, detectorId: "gen", appBuildRef: "b1", journeyHint: "share_drawing" },
      generator,
    );
    expect(res.ok && res.detector.status).toBe("needs_instrumentation");
    expect(res.ok && res.detector.provenance).toBe("devin");
    const malformed: DetectorGenerator = {
      name: "test",
      generate: async () => ({ raw: { nope: true }, handle: {} }),
    };
    const bad = await generateDetector(
      { productId, detectorId: "gen2", appBuildRef: "b1", journeyHint: "x" },
      malformed,
    );
    expect(bad.ok).toBe(false);
  });
});
