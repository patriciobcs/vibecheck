import { SAMPLE_STUDY_PLAN } from "@vibecheck/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/db/client";
import { MemoryIssuePublisher } from "@/providers/github/memory";
import { fixturePreviewDeployer } from "@/providers/previews/fixture";
import { fixtureRepairProvider } from "@/providers/repair/fixture";
import { fixtureValidator } from "@/providers/validators/fixture";
import { resetDb } from "@/test/db";
import { seedStudy } from "@/test/fixtures";
import { runRepair } from "./repairs";

beforeEach(resetDb);

async function seedRepair(mode: "draft_pr" | "prototype_and_retest") {
  const { tenantId, studyId } = await seedStudy({
    automation: { ...SAMPLE_STUDY_PLAN.automation, mode },
  });
  const findingId = `finding-${mode}`;
  await db.insert(schema.findings).values({
    id: findingId,
    tenantId,
    studyId,
    studyRevision: 1,
    baselineCommitSha: "base-sha",
    title: "Toolbar: sticky note tool is hard to discover",
    fingerprint: `fingerprint-${mode}`,
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
  const repairRunId = `repair-${mode}`;
  await db.insert(schema.repairRuns).values({
    id: repairRunId,
    tenantId,
    findingId,
    studyId,
    studyRevision: 1,
    issueRepo: "owner/repo",
    issueNumber: 1,
    mode,
    baseCommitSha: "base-sha",
    branch: `vibecheck/${repairRunId}`,
    maxAttempts: 1,
    validatorVersion: "fixture_validator_v1",
    status: "queued",
  });
  return { repairRunId };
}

describe("runRepair preview behavior", () => {
  it("leaves a draft PR ready when draft_pr uses the fixture deployer", async () => {
    const { repairRunId } = await seedRepair("draft_pr");
    const result = await runRepair(repairRunId, {
      provider: fixtureRepairProvider,
      validator: fixtureValidator,
      deployer: fixturePreviewDeployer,
      publisher: new MemoryIssuePublisher(),
    });

    expect(result.status).toBe("draft_pr_ready");
  });

  it("deploys a real-provider preview in draft_pr mode", async () => {
    const { repairRunId } = await seedRepair("draft_pr");
    const publisher = new MemoryIssuePublisher();
    const result = await runRepair(repairRunId, {
      provider: fixtureRepairProvider,
      validator: fixtureValidator,
      deployer: {
        name: "vercel",
        async deploy() {
          return { deploymentId: "dpl_test", url: "https://preview.example.test" };
        },
        async health() {
          return "healthy";
        },
      },
      publisher,
    });

    expect(result.status).toBe("preview_ready");
    expect(publisher.comments).toEqual([
      expect.stringContaining("Preview (Vercel, candidate candida): https://preview.example.test"),
    ]);
  });
});
