import { describe, expect, it } from "vitest";
import { handleDiscoveryRun, markDiscoveryRunFailed } from "./handler";
import type { DiscoveryProvider } from "@/agents/types";
import { db } from "@/db";
import { discoveryRun, product, proposal, tenant as tenantTable } from "@/db/schema";
import { eq } from "drizzle-orm";

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

describe.skipIf(!process.env.DATABASE_URL)("discovery worker handler", () => {
  it("corrects malformed output once and preserves both responses", async () => {
    const [tenant] = await db.insert(tenantTable).values({ name: "worker-test" }).returning();
    const [productRow] = await db
      .insert(product)
      .values({
        tenantId: tenant.id,
        name: "test",
        description: "",
        url: "http://example.com",
        permittedOrigins: [],
        language: "en",
        audience: "",
        releaseNotes: [],
        supportComplaints: [],
        knownJourneys: [],
        productEvents: [],
        status: "ready",
      })
      .returning();
    const [run] = await db
      .insert(discoveryRun)
      .values({
        tenantId: tenant.id,
        productId: productRow.id,
        status: "queued",
        provider: "fixture",
        sourceRevision: "sha",
        rawResponses: [],
      })
      .returning();
    let calls = 0;
    const provider: DiscoveryProvider = {
      name: "test",
      propose: async () => ({ raw: { malformed: true }, handle: {} }),
      requestCorrection: async () => {
        calls += 1;
        return { raw: { ...valid, discovery_run_id: run.id }, handle: {} };
      },
    };
    await handleDiscoveryRun(run.id, provider);
    const [result] = await db
      .select()
      .from(discoveryRun)
      .where(eq(discoveryRun.id, run.id))
      .limit(1);
    const proposals = await db.select().from(proposal).where(eq(proposal.discoveryRunId, run.id));
    expect({
      status: result?.status,
      correctionAttempts: result?.correctionAttempts,
      rawResponses: (result?.rawResponses as unknown[]).length,
      proposals: proposals.length,
      calls,
    }).toEqual({
      status: "proposed",
      correctionAttempts: 1,
      rawResponses: 2,
      proposals: 1,
      calls: 1,
    });
    await db.delete(tenantTable).where(eq(tenantTable.id, tenant.id));
  });

  it("fails malformed output after one correction without proposals", async () => {
    const [tenant] = await db.insert(tenantTable).values({ name: "worker-test-fail" }).returning();
    const [productRow] = await db
      .insert(product)
      .values({
        tenantId: tenant.id,
        name: "test",
        description: "",
        url: "http://example.com",
        permittedOrigins: [],
        language: "en",
        audience: "",
        releaseNotes: [],
        supportComplaints: [],
        knownJourneys: [],
        productEvents: [],
        status: "ready",
      })
      .returning();
    const [run] = await db
      .insert(discoveryRun)
      .values({
        tenantId: tenant.id,
        productId: productRow.id,
        status: "queued",
        provider: "fixture",
        sourceRevision: "sha",
        rawResponses: [],
      })
      .returning();
    const provider: DiscoveryProvider = {
      name: "test",
      propose: async () => ({ raw: { malformed: true }, handle: {} }),
      requestCorrection: async () => ({ raw: { malformed: true }, handle: {} }),
    };
    await handleDiscoveryRun(run.id, provider);
    const [result] = await db
      .select()
      .from(discoveryRun)
      .where(eq(discoveryRun.id, run.id))
      .limit(1);
    const proposals = await db.select().from(proposal).where(eq(proposal.discoveryRunId, run.id));
    expect({
      status: result?.status,
      error: result?.error,
      proposals: proposals.length,
    }).toEqual({ status: "failed", error: "malformed_agent_output", proposals: 0 });
    await db.delete(tenantTable).where(eq(tenantTable.id, tenant.id));
  });

  it("marks a run failed when the provider throws", async () => {
    const [tenant] = await db.insert(tenantTable).values({ name: "worker-test-throw" }).returning();
    const [productRow] = await db
      .insert(product)
      .values({
        tenantId: tenant.id,
        name: "test",
        description: "",
        url: "http://example.com",
        permittedOrigins: [],
        language: "en",
        audience: "",
        releaseNotes: [],
        supportComplaints: [],
        knownJourneys: [],
        productEvents: [],
        status: "ready",
      })
      .returning();
    const [run] = await db
      .insert(discoveryRun)
      .values({
        tenantId: tenant.id,
        productId: productRow.id,
        status: "queued",
        provider: "fixture",
        sourceRevision: "sha",
        rawResponses: [],
      })
      .returning();
    const provider: DiscoveryProvider = {
      name: "test",
      propose: async () => {
        throw new Error("devin_api_400");
      },
      requestCorrection: async () => ({ raw: null, handle: {} }),
    };
    await expect(handleDiscoveryRun(run.id, provider)).rejects.toThrow("devin_api_400");
    await markDiscoveryRunFailed(run.id, new Error("devin_api_400"));
    const [result] = await db
      .select()
      .from(discoveryRun)
      .where(eq(discoveryRun.id, run.id))
      .limit(1);
    expect({ status: result?.status, error: result?.error }).toEqual({
      status: "failed",
      error: "devin_api_400",
    });
    await db.delete(tenantTable).where(eq(tenantTable.id, tenant.id));
  });
});
