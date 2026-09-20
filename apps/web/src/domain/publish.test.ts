import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/db/client";
import type { DiscoveryProvider } from "@/providers/discovery/types";
import { resetDb } from "@/test/db";
import { handleDiscoveryRun } from "./discovery";
import { createDiscoveryRun, createProduct } from "./products";
import { publishStudy } from "./publish";

async function proposedRun() {
  await db.insert(schema.tenants).values({ id: "tenant_t", name: "t" });
  const p = await createProduct(
    "tenant_t",
    { name: "Acme", url: "https://acme.example" },
    async () => ["93.184.216.34"],
  );
  const run = await createDiscoveryRun("tenant_t", p.id, "fixture");
  if (!run) throw new Error("run");
  const out = {
    schema_version: "1.0",
    discovery_run_id: run.id,
    source_revision: run.sourceRevision,
    outcome: "proposed",
    proposals: [
      {
        task_id: "task",
        research_question: "q",
        participant_prompt: "p",
        rationale: "r",
        evidence_refs: [],
        evidence_type: "reported",
        eligibility_rule_ref: "eligible_whiteboard_users_v1",
        success_rule_ref: "stickynote_capture_v1",
        uncertainties: [],
        scenario: {
          intro: "Complete the task.",
          steps: [{ order: 1, instruction: "Add the item." }],
          think_aloud_cues: ["What are you looking for?"],
          estimated_minutes: 5,
        },
      },
    ],
  };
  const provider: DiscoveryProvider = {
    name: "test",
    propose: async () => ({ raw: out, handle: {} }),
    requestCorrection: async () => ({ raw: out, handle: {} }),
  };
  await handleDiscoveryRun(run.id, provider);
  return { productId: p.id, runId: run.id };
}

const input = (productId: string, runId: string) => ({
  product_id: productId,
  discovery_run_id: runId,
  task_id: "task",
  fixture_ref: "fixture",
  baseline: { commit_sha: "0000000000000000000000000000000000000000", environment_ref: "env" },
});

beforeEach(resetDb);

describe("publishStudy", () => {
  it("publishes a study with an immutable revision and one study.published event", async () => {
    const { productId, runId } = await proposedRun();
    const res = await publishStudy("tenant_t", "key-1", input(productId, runId));
    expect(res?.status).toBe(201);
    expect(res?.plan.task.task_id).toBe("task");
    expect(res?.plan.recruitment.eligibility_rule_ref).toBe("eligible_whiteboard_users_v1");
    expect(res?.plan.task.scenario?.intro).toBe("Complete the task.");
    const revisions = await db.query.studyRevisions.findMany();
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.provenance).toBe("vc01");
    const events = await db.query.eventOutbox.findMany();
    expect(events.map((e) => e.eventType)).toEqual(["study.published"]);
  });

  it("deduplicates sequential and concurrent idempotent publishes", async () => {
    const { productId, runId } = await proposedRun();
    const body = input(productId, runId);
    const first = await publishStudy("tenant_t", "same", body);
    const second = await publishStudy("tenant_t", "same", body);
    const concurrent = await Promise.all([
      publishStudy("tenant_t", "concurrent", body),
      publishStudy("tenant_t", "concurrent", body),
    ]);
    expect({
      first: first?.status,
      second: second?.status,
      same: first?.study.id === second?.study.id,
      concurrent: concurrent.map((c) => c?.status).sort(),
      ids: new Set(concurrent.map((c) => c?.study.id)).size,
    }).toEqual({
      first: 201,
      second: 200,
      same: true,
      concurrent: [200, 201],
      ids: 1,
    });
    expect(await db.$count(schema.studies)).toBe(2);
    expect(await db.$count(schema.eventOutbox)).toBe(2);
    const different = await publishStudy("tenant_t", "different", body);
    expect(different?.status).toBe(201);
    expect(await db.$count(schema.studies)).toBe(3);
  });

  it("returns null when the proposal belongs to another tenant", async () => {
    const { productId, runId } = await proposedRun();
    expect(await publishStudy("tenant_other", "k", input(productId, runId))).toBeNull();
  });
});
