import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/db/client";
import type { DiscoveryProvider } from "@/providers/discovery/types";
import { resetDb } from "@/test/db";
import { handleDiscoveryRun, markDiscoveryRunFailed } from "./discovery";
import { createDiscoveryRun, createProduct } from "./products";

const valid = {
  schema_version: "1.0",
  discovery_run_id: "run",
  source_revision: "sha",
  outcome: "proposed",
  proposals: [
    {
      task_id: "task",
      research_question: "question",
      participant_prompt: "prompt",
      rationale: "rationale",
      evidence_refs: ["ref"],
      evidence_type: "reported",
      eligibility_rule_ref: "eligible_whiteboard_users_v1",
      success_rule_ref: "stickynote_capture_v1",
      uncertainties: [],
    },
  ],
};

async function queuedRun() {
  await db.insert(schema.tenants).values({ id: "tenant_t", name: "t" });
  const p = await createProduct(
    "tenant_t",
    { name: "Acme", url: "https://acme.example" },
    async () => ["93.184.216.34"],
  );
  const run = await createDiscoveryRun("tenant_t", p.id, "fixture");
  if (!run) throw new Error("run");
  return run;
}

beforeEach(resetDb);

describe("handleDiscoveryRun", () => {
  it("corrects malformed output once and preserves both raw responses", async () => {
    const run = await queuedRun();
    let corrections = 0;
    const provider: DiscoveryProvider = {
      name: "test",
      propose: async () => ({ raw: { malformed: true }, handle: {} }),
      requestCorrection: async () => {
        corrections += 1;
        return {
          raw: { ...valid, discovery_run_id: run.id, source_revision: run.sourceRevision },
          handle: {},
        };
      },
    };
    await handleDiscoveryRun(run.id, provider);
    const result = await db.query.discoveryRuns.findFirst();
    const proposals = await db.query.proposals.findMany();
    expect({
      status: result?.status,
      corrections: result?.correctionAttempts,
      raw: result?.rawResponses.length,
      proposals: proposals.length,
      calls: corrections,
    }).toEqual({
      status: "proposed",
      corrections: 1,
      raw: 2,
      proposals: 1,
      calls: 1,
    });
  });

  it("fails after one correction when output is still malformed, without proposals", async () => {
    const run = await queuedRun();
    const provider: DiscoveryProvider = {
      name: "test",
      propose: async () => ({ raw: { malformed: true }, handle: {} }),
      requestCorrection: async () => ({ raw: { malformed: true }, handle: {} }),
    };
    await handleDiscoveryRun(run.id, provider);
    const result = await db.query.discoveryRuns.findFirst();
    expect({
      status: result?.status,
      error: result?.error,
      proposals: await db.$count(schema.proposals),
    }).toEqual({ status: "failed", error: "malformed_agent_output", proposals: 0 });
  });

  it("rejects an unregistered success rule as malformed", async () => {
    const run = await queuedRun();
    const bad = {
      ...valid,
      discovery_run_id: run.id,
      source_revision: run.sourceRevision,
      proposals: [{ ...valid.proposals[0], success_rule_ref: "made_up_v1" }],
    };
    const provider: DiscoveryProvider = {
      name: "test",
      propose: async () => ({ raw: bad, handle: {} }),
      requestCorrection: async () => ({ raw: bad, handle: {} }),
    };
    await handleDiscoveryRun(run.id, provider);
    expect((await db.query.discoveryRuns.findFirst())?.status).toBe("failed");
  });

  it("stores a cannot_assess outcome without proposals and no downstream work", async () => {
    const run = await queuedRun();
    const out = {
      schema_version: "1.0",
      discovery_run_id: run.id,
      source_revision: run.sourceRevision,
      outcome: "cannot_assess",
      outcome_reason: "no context",
      proposals: [],
    };
    const provider: DiscoveryProvider = {
      name: "test",
      propose: async () => ({ raw: out, handle: {} }),
      requestCorrection: async () => ({ raw: out, handle: {} }),
    };
    await handleDiscoveryRun(run.id, provider);
    const result = await db.query.discoveryRuns.findFirst();
    expect({
      status: result?.status,
      outcome: result?.outcome,
      reason: result?.outcomeReason,
    }).toEqual({ status: "proposed", outcome: "cannot_assess", reason: "no context" });
    expect(await db.$count(schema.studies)).toBe(0);
  });

  it("marks a run failed when the provider throws", async () => {
    const run = await queuedRun();
    const provider: DiscoveryProvider = {
      name: "test",
      propose: async () => {
        throw new Error("devin_api_400");
      },
      requestCorrection: async () => ({ raw: null, handle: {} }),
    };
    await expect(handleDiscoveryRun(run.id, provider)).rejects.toThrow("devin_api_400");
    await markDiscoveryRunFailed(run.id, new Error("devin_api_400"));
    const result = await db.query.discoveryRuns.findFirst();
    expect({ status: result?.status, error: result?.error }).toEqual({
      status: "failed",
      error: "devin_api_400",
    });
  });
});
