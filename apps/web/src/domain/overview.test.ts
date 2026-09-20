import { SAMPLE_STUDY_PLAN } from "@vibecheck/contracts";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/db/client";
import { resetDb } from "@/test/db";
import { seedStudy } from "@/test/fixtures";
import { productOverview } from "./overview";

beforeEach(resetDb);

describe("productOverview", () => {
  it("summarizes studies and research candidates for an owned product", async () => {
    const { tenantId, productId, studyId } = await seedStudy();
    await db.insert(schema.researchCandidates).values({
      id: "candidate-overview",
      tenantId,
      productId,
      journeyId: "journey-overview",
      targetRef: "toolbar",
      category: "discoverability",
      baselineBuildRef: "build-1",
      detectorRef: "detector-1",
      suspectedProblem: "The toolbar target may be hard to discover.",
      evaluationRefs: [],
      supportingEventRefs: [],
      evidenceLimitations: ["Passive signal only."],
      distinctObservationSessions: 2,
      distinctJourneyInstances: 2,
      state: "proposed",
    });
    const overview = await productOverview([tenantId], productId);
    expect(overview?.product.id).toBe(productId);
    expect(overview?.studies.map((s) => s.id)).toEqual([studyId]);
    expect(overview?.candidates_by_state).toEqual({
      proposed: 1,
      accepted: 0,
      dismissed: 0,
      study_linked: 0,
    });
    expect(overview?.latest_candidates).toMatchObject([
      {
        category: "discoverability",
        target_ref: "toolbar",
        distinct_observation_sessions: 2,
        state: "proposed",
      },
    ]);
    expect(overview?.open_issues).toBe(0);
    expect(overview?.paused).toBe(false);
    expect(await productOverview(["tenant_other"], productId)).toBeNull();
  });

  it("includes repository binding details and setup errors", async () => {
    const { tenantId, productId } = await seedStudy();
    await db
      .update(schema.products)
      .set({
        repoBinding: {
          provider: "github",
          owner: "owner",
          repo: "repo",
          default_branch: "main",
          baseline_commit_sha: "a".repeat(40),
          issues_enabled: true,
        },
        status: "needs_setup",
        setupError: "Repository setup needs attention.",
      })
      .where(eq(schema.products.id, productId));
    const overview = await productOverview([tenantId], productId);
    expect(overview?.product.repo_binding).toMatchObject({
      kind: "github",
      repo: "owner/repo",
      default_branch: "main",
      baseline_commit_sha: "a".repeat(40),
    });
    expect(overview?.product.setup_error).toBe("Repository setup needs attention.");
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
