import { SAMPLE_STUDY_PLAN, SignalSchema } from "@vibecheck/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/db/client";
import { resetDb } from "@/test/db";
import { seedStudy } from "@/test/fixtures";
import { productOverview } from "./overview";
import { ingestSignal } from "./signals";

beforeEach(resetDb);

describe("productOverview", () => {
  it("summarizes studies, findings and signals for an owned product", async () => {
    const { tenantId, productId, studyId } = await seedStudy();
    await ingestSignal({
      tenantIds: [tenantId],
      productId,
      signal: SignalSchema.parse({
        schema_version: "1.0",
        signal_id: "s1",
        source: "jev",
        title: "Toolbar hesitation",
        description: "Hesitation observed.",
        severity: "high",
        semantic_target: "toolbar",
        window_start: "2025-01-01T00:00:00Z",
        window_end: "2025-01-02T00:00:00Z",
        evidence_ref: null,
      }),
      actorUserId: null,
    });
    const overview = await productOverview([tenantId], productId);
    expect(overview?.product.id).toBe(productId);
    expect(overview?.studies.map((s) => s.id)).toEqual([studyId]);
    expect(overview?.signals_by_severity).toEqual({ low: 0, medium: 0, high: 1 });
    expect(overview?.open_issues).toBe(0);
    expect(overview?.paused).toBe(false);
    expect(await productOverview(["tenant_other"], productId)).toBeNull();
  });

  it("marks a draft PR repair ready and counts its status", async () => {
    const { tenantId, productId, studyId } = await seedStudy({
      automation: { ...SAMPLE_STUDY_PLAN.automation, mode: "draft_pr" },
    });
    await db.insert(schema.findings).values({
      id: "finding-overview-repair",
      tenantId,
      studyId,
      studyRevision: 1,
      baselineCommitSha: "a".repeat(40),
      title: "Toolbar: sticky note tool is hard to discover",
      fingerprint: "overview-repair-fingerprint",
      category: "discoverability",
      semanticTarget: "toolbar",
      observation: "The tool was hard to find.",
      hypothesis: "The control may be hidden.",
      impact: "task_slowed",
      certainty: "preliminary",
      limitations: [],
      suggestedExperiment: null,
      evidence: [],
      observedSessionCount: 1,
      eligibleSessionCount: 1,
      provenance: "fixture",
    });
    await db.insert(schema.repairRuns).values({
      id: "repair-overview-ready",
      tenantId,
      findingId: "finding-overview-repair",
      studyId,
      studyRevision: 1,
      issueRepo: "owner/repo",
      issueNumber: 1,
      mode: "draft_pr",
      baseCommitSha: "a".repeat(40),
      maxAttempts: 1,
      validatorVersion: "fixture_validator_v1",
      status: "draft_pr_ready",
    });
    const overview = await productOverview([tenantId], productId);
    expect(overview?.studies[0]?.stages.find((stage) => stage.key === "draft_pr")).toMatchObject({
      state: "done",
    });
    expect(overview?.repairs_by_status).toEqual({ draft_pr_ready: 1 });
  });
});
