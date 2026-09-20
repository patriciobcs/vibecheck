import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import {
  checkRun,
  finding,
  outboxEvent,
  product,
  repairRun,
  study,
  studyPlanRevision,
  tenant,
} from "@/db/schema";
import type { RepairProvider } from "@/agents/repair/types";
import { fixtureRepairProvider } from "@/agents/repair/fixture";
import type { ProviderResult } from "@/agents/types";
import type { Validator } from "@/validators/types";
import { fixtureValidator } from "@/validators/fixture";
import type { PreviewDeployer } from "@/previews/types";
import { enqueueRepair, runRepair } from "./repairs";
import type { RepoPublisher } from "@/publishers/types";

const BASELINE = "base-sha";

function planFor(
  studyId: string,
  productId: string,
  mode: "issues_only" | "draft_pr" | "prototype_and_retest",
) {
  return {
    schema_version: "1.0" as const,
    study_id: studyId,
    study_revision: 1,
    product_id: productId,
    task: {
      task_id: "capture",
      participant_prompt: "Add an idea.",
      research_question: "Can users add ideas?",
      time_limit_seconds: 300,
      success_rule_ref: "capture_v1",
      fixture_ref: "fixture_v1",
    },
    baseline: { commit_sha: BASELINE, environment_ref: "fixture" },
    recruitment: {
      source: "direct_link" as const,
      target_count: 1,
      cohort: "fixture",
      eligibility_rule_ref: "eligible",
    },
    capture: {
      screen: "required" as const,
      microphone: "off" as const,
      webcam: "off" as const,
      pointer: "on" as const,
      keyboard: "semantic_only" as const,
      text_values: "off" as const,
      retention_days: 1,
    },
    automation: {
      mode,
      max_variants: 1,
      max_repair_attempts: 2,
      agent_budget_ref: "fixture",
      retest_target_count: 1,
    },
  };
}

async function fixture(mode: "draft_pr" | "prototype_and_retest") {
  const [tenantRow] = await db
    .insert(tenant)
    .values({ name: `repair-${randomUUID()}` })
    .returning();
  const [productRow] = await db
    .insert(product)
    .values({
      tenantId: tenantRow.id,
      name: "repair fixture",
      description: "fixture",
      url: "http://example.com",
      permittedOrigins: [],
      language: "en",
      audience: "testers",
      releaseNotes: [],
      supportComplaints: [],
      knownJourneys: [],
      productEvents: [],
      status: "ready",
    })
    .returning();
  const [studyRow] = await db
    .insert(study)
    .values({
      tenantId: tenantRow.id,
      productId: productRow.id,
      status: "published",
      currentRevision: 1,
    })
    .returning();
  const plan = planFor(studyRow.id, productRow.id, mode);
  await db.insert(studyPlanRevision).values({
    studyId: studyRow.id,
    revision: 1,
    plan,
    publishedAt: new Date(),
  });
  const [findingRow] = await db
    .insert(finding)
    .values({
      tenantId: tenantRow.id,
      studyId: studyRow.id,
      studyRevision: 1,
      baselineCommitSha: BASELINE,
      title: "Toolbar: sticky note tool is hard to discover",
      fingerprint: randomUUID(),
      category: "discoverability",
      semanticTarget: "toolbar.sticky_note",
      observation: "The note tool was difficult to find.",
      hypothesis: "The note tool may be difficult to discover.",
      impact: "task_slowed",
      certainty: "preliminary",
      limitations: ["fixture"],
      suggestedExperiment: "Label the note tool.",
      evidence: [],
      observedSessionCount: 1,
      eligibleSessionCount: 1,
      provenance: "fixture",
    })
    .returning();
  const [run] = await db
    .insert(repairRun)
    .values({
      tenantId: tenantRow.id,
      findingId: findingRow.id,
      studyId: studyRow.id,
      studyRevision: 1,
      issueRepo: "owner/repo",
      issueNumber: 4,
      mode,
      baseCommitSha: BASELINE,
      branch: `vibecheck/repair-${findingRow.id}`,
      maxAttempts: 2,
      validatorVersion: "fixture_validator_v1",
    })
    .returning();
  return { tenantRow, run };
}

function publisher(): RepoPublisher {
  return {
    async findByMarker() {
      return null;
    },
    async create() {
      return { number: 4, url: "https://github.com/owner/repo/issues/4" };
    },
    async comment() {},
    async getCommit() {
      return true;
    },
    async getBranchSha() {
      return "candidate-sha";
    },
    async compareFiles() {
      return ["packages/excalidraw/components/Toolbar.tsx"];
    },
    async createDraftPullRequest() {
      return { number: 8, url: "https://github.com/owner/repo/pull/8" };
    },
  };
}

function cannotReproduceProvider(repairRunId: string): RepairProvider {
  const response = {
    schema_version: "1.0" as const,
    repair_run_id: repairRunId,
    reproduced: false,
    reproduction_notes: "Could not reproduce.",
    outcome: "cannot_reproduce" as const,
    branch: null,
    summary: "No reproduction.",
    changed_paths: [],
    limitations: ["fixture"],
  };
  return {
    name: "test",
    async start(): Promise<ProviderResult> {
      return { handle: {}, raw: response };
    },
    async revise() {
      return { handle: {}, raw: response };
    },
  };
}

describe.skipIf(!process.env.DATABASE_URL)("repair service", () => {
  it("reaches preview_ready and emits a preview event", async () => {
    const data = await fixture("prototype_and_retest");
    const result = await runRepair(data.run.id, {
      provider: fixtureRepairProvider,
      publisher: publisher(),
    });
    const [stored] = await db.select().from(repairRun).where(eq(repairRun.id, data.run.id));
    const previews = await db
      .select()
      .from(outboxEvent)
      .where(
        and(eq(outboxEvent.correlationId, data.run.id), eq(outboxEvent.eventType, "preview.ready")),
      );
    expect({ status: result.status, stored: stored?.status, previews: previews.length }).toEqual({
      status: "preview_ready",
      stored: "preview_ready",
      previews: 1,
    });
    await db.delete(tenant).where(eq(tenant.id, data.tenantRow.id));
  });

  it("reuses a persisted preview on replay", async () => {
    const data = await fixture("prototype_and_retest");
    let deployments = 0;
    const deployer: PreviewDeployer = {
      name: "fixture",
      async deploy(input) {
        deployments += 1;
        return {
          deploymentId: `deployment-${input.repairRunId}`,
          url: `https://preview.invalid/${input.commitSha}`,
        };
      },
      async health() {
        return "healthy" as const;
      },
    };
    const deps = { provider: fixtureRepairProvider, publisher: publisher(), deployer };
    await runRepair(data.run.id, deps);
    const replay = await runRepair(data.run.id, deps);
    expect({ status: replay.status, deployments }).toEqual({
      status: "preview_ready",
      deployments: 1,
    });
    await db.delete(tenant).where(eq(tenant.id, data.tenantRow.id));
  });

  it("stops at draft_pr_ready without creating a preview", async () => {
    const data = await fixture("draft_pr");
    const result = await runRepair(data.run.id, {
      provider: fixtureRepairProvider,
      publisher: publisher(),
    });
    const [stored] = await db.select().from(repairRun).where(eq(repairRun.id, data.run.id));
    expect({ status: result.status, stored: stored?.status, previewId: stored?.previewId }).toEqual(
      {
        status: "draft_pr_ready",
        stored: "draft_pr_ready",
        previewId: null,
      },
    );
    await db.delete(tenant).where(eq(tenant.id, data.tenantRow.id));
  });

  it("revises once after a failed check and validates the fresh candidate", async () => {
    const data = await fixture("draft_pr");
    let revisions = 0;
    let validations = 0;
    const provider: RepairProvider = {
      ...fixtureRepairProvider,
      async revise(handle, diagnostics) {
        revisions += 1;
        return fixtureRepairProvider.revise(handle, diagnostics);
      },
    };
    const validator: Validator = {
      version: "fixture_validator_v1",
      async run(input) {
        validations += 1;
        const result = await fixtureValidator.run(input);
        return validations === 1 ? { ...result, status: "failed" as const } : result;
      },
    };
    const result = await runRepair(data.run.id, {
      provider,
      validator,
      publisher: publisher(),
    });
    expect({ status: result.status, revisions, validations }).toEqual({
      status: "draft_pr_ready",
      revisions: 1,
      validations: 2,
    });
    await db.delete(tenant).where(eq(tenant.id, data.tenantRow.id));
  });

  it("does not enqueue repair work for issues_only", async () => {
    const data = await fixture("draft_pr");
    const [findingRow] = await db.select().from(finding).where(eq(finding.id, data.run.findingId));
    const plan = planFor(data.run.studyId, "unused", "issues_only");
    const result = await db.transaction((tx) =>
      enqueueRepair(
        tx,
        findingRow!,
        { repo: "owner/repo", number: 4, url: "https://github.com/owner/repo/issues/4" },
        plan,
      ),
    );
    expect(result).toBeNull();
    await db.delete(tenant).where(eq(tenant.id, data.tenantRow.id));
  });

  it("stops without a PR when the finding cannot be reproduced", async () => {
    const data = await fixture("draft_pr");
    const result = await runRepair(data.run.id, {
      provider: cannotReproduceProvider(data.run.id),
      publisher: publisher(),
    });
    const checks = await db.select().from(checkRun).where(eq(checkRun.repairRunId, data.run.id));
    expect({ status: result.status, checks: checks.length }).toEqual({
      status: "blocked",
      checks: 0,
    });
    await db.delete(tenant).where(eq(tenant.id, data.tenantRow.id));
  });
});
