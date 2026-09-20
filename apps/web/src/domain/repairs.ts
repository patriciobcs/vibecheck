import { randomUUID } from "node:crypto";
import {
  checksCompletedPayload,
  previewReadyPayload,
  type RepairOutput,
  repairCandidateReadyPayload,
  repairOutputSchema,
  type StudyPlan,
  StudyPlanSchema,
  toRepairRunContract,
  workflowBlockedPayload,
} from "@vibecheck/contracts";
import { and, desc, eq } from "drizzle-orm";
import { db, schema, type Tx } from "@/db/client";
import { env } from "@/lib/env";
import { newId } from "@/lib/ids";
import type { ProviderHandle } from "@/providers/analysis/types";
import { githubIssuePublisher } from "@/providers/github/github";
import { memoryIssuePublisher } from "@/providers/github/memory";
import type { RepoPublisher } from "@/providers/github/types";
import { fixturePreviewDeployer } from "@/providers/previews/fixture";
import type { PreviewDeployer } from "@/providers/previews/types";
import { createVercelPreviewDeployer } from "@/providers/previews/vercel";
import { demoAllowedPaths, demoInvariants } from "@/providers/repair/demo-policy";
import { createDevinRepairProvider } from "@/providers/repair/devin";
import { fixtureRepairProvider } from "@/providers/repair/fixture";
import type { RepairContext, RepairProvider } from "@/providers/repair/types";
import { fixtureValidator } from "@/providers/validators/fixture";
import type { Validator } from "@/providers/validators/types";
import { emitEvent } from "./events";
import { renderIssueBody, renderReproductionSteps } from "./issues";
import { enqueueJob } from "./jobs";

type Finding = typeof schema.findings.$inferSelect;
type RepairRun = typeof schema.repairRuns.$inferSelect;
type IssueRef = { repo: string; number: number; url: string };
export type RepairDeps = {
  provider?: RepairProvider;
  validator?: Validator;
  deployer?: PreviewDeployer;
  publisher?: RepoPublisher;
};

function providerFor() {
  const cfg = env().devin;
  if (env().REPAIR_PROVIDER === "devin") {
    if (!cfg) throw new Error("devin_not_configured");
    return createDevinRepairProvider(cfg);
  }
  return fixtureRepairProvider;
}

function validatorFor() {
  if (env().VALIDATOR !== "fixture") {
    throw new Error(`validator_unavailable_${env().VALIDATOR}`);
  }
  return fixtureValidator;
}

function deployerFor() {
  const settings = env();
  if (settings.PREVIEW_PROVIDER === "vercel") {
    if (!settings.VERCEL_TOKEN || !settings.VERCEL_PROJECT_ID)
      throw new Error("preview_provider_unconfigured");
    return createVercelPreviewDeployer({
      token: settings.VERCEL_TOKEN,
      projectId: settings.VERCEL_PROJECT_ID,
      teamId: settings.VERCEL_TEAM_ID,
      apiBase: settings.VERCEL_API_BASE,
      deployTimeoutMs: settings.VERCEL_DEPLOY_TIMEOUT_MS,
      pollMs: settings.VERCEL_POLL_MS,
    });
  }
  return fixturePreviewDeployer;
}

function repoParts(value: string) {
  const [owner, repo] = value.split("/", 2);
  if (!owner || !repo) throw new Error("repair_repo_invalid");
  return { owner, repo };
}

function isGithubPermissionError(error: unknown) {
  return error instanceof Error && /github_(api|app_auth)_(403|422)/.test(error.message);
}

async function emitRepairEvent(input: {
  type:
    | "checks.completed"
    | "workflow.blocked"
    | "repair.candidate_ready"
    | "repair.draft_pr_ready"
    | "preview.ready";
  tenantId: string;
  productId: string;
  correlationId: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}) {
  return db.transaction((tx) => emitEvent(tx, input));
}

function outputOrThrow(raw: unknown, repairRunId: string): RepairOutput {
  const parsed = repairOutputSchema.parse(raw);
  if (parsed.repair_run_id !== repairRunId) {
    throw new Error("repair_output_run_mismatch");
  }
  return parsed;
}

type StepResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "blocked"; reason: string }
  | { kind: "failed"; reason: string };

async function withGithub<T>(operation: () => Promise<T>): Promise<StepResult<T>> {
  try {
    return { kind: "ok", value: await operation() };
  } catch (error) {
    if (isGithubPermissionError(error)) return { kind: "blocked", reason: "github_permissions" };
    throw error;
  }
}

async function transition(id: string, status: RepairRun["status"], values = {}) {
  const [updated] = await db
    .update(schema.repairRuns)
    .set({ status, ...values })
    .where(eq(schema.repairRuns.id, id))
    .returning();
  return updated;
}

async function ensureBaseCommit(
  publisher: RepoPublisher,
  repo: { owner: string; repo: string },
  baseCommitSha: string,
): Promise<StepResult<true>> {
  const result = await withGithub(async () =>
    publisher.getCommit ? publisher.getCommit(repo, baseCommitSha) : true,
  );
  if (result.kind !== "ok") return result;
  return result.value
    ? { kind: "ok", value: true }
    : { kind: "failed", reason: "base_sha_missing" };
}

export async function enqueueRepair(tx: Tx, row: Finding, issueRef: IssueRef, plan: StudyPlan) {
  if (plan.automation.mode === "issues_only") return null;
  const repairRunId = randomUUID();
  const [created] = await tx
    .insert(schema.repairRuns)
    .values({
      id: repairRunId,
      tenantId: row.tenantId,
      findingId: row.id,
      studyId: row.studyId,
      studyRevision: row.studyRevision,
      issueRepo: issueRef.repo,
      issueNumber: issueRef.number,
      mode: plan.automation.mode,
      baseCommitSha: row.baselineCommitSha,
      branch: `vibecheck/repair-${repairRunId}`,
      maxAttempts: Math.max(1, plan.automation.max_repair_attempts),
      validatorVersion: "fixture_validator_v1",
    })
    .onConflictDoNothing({ target: schema.repairRuns.findingId })
    .returning();
  if (!created) return null;
  await enqueueJob(
    {
      type: "repair.run",
      payload: { repairRunId: created.id },
      dedupeKey: `repair.run:${created.id}`,
      maxAttempts: 3,
    },
    tx,
  );
  return created;
}

async function loadContext(run: RepairRun) {
  const [findingRow] = await db
    .select()
    .from(schema.findings)
    .where(eq(schema.findings.id, run.findingId))
    .limit(1);
  if (!findingRow) throw new Error("finding_not_found");
  const [studyRow] = await db
    .select()
    .from(schema.studies)
    .where(eq(schema.studies.id, run.studyId))
    .limit(1);
  if (!studyRow) throw new Error("study_not_found");
  const [planRow] = await db
    .select()
    .from(schema.studyRevisions)
    .where(
      and(
        eq(schema.studyRevisions.studyId, run.studyId),
        eq(schema.studyRevisions.revision, run.studyRevision),
      ),
    )
    .limit(1);
  if (!planRow) throw new Error("study_plan_not_found");
  const plan = StudyPlanSchema.parse(planRow.plan);
  const repository = repoParts(run.issueRepo);
  const context: RepairContext = {
    repairRunId: run.id,
    repo: repository,
    baseCommitSha: run.baseCommitSha,
    branchName: run.branch ?? `vibecheck/repair-${run.id}`,
    finding: {
      title: findingRow.title,
      category: findingRow.category,
      semanticTarget: findingRow.semanticTarget,
      observation: findingRow.observation,
      hypothesis: findingRow.hypothesis,
      suggestedExperiment: findingRow.suggestedExperiment,
      limitations: findingRow.limitations,
      reproductionSteps: renderReproductionSteps(findingRow).join("\n"),
    },
    task: {
      participant_prompt: plan.task.participant_prompt,
      success_rule_ref: plan.task.success_rule_ref,
    },
    allowedPaths: demoAllowedPaths,
    invariants: demoInvariants,
  };
  return {
    findingRow,
    studyRow,
    productId: studyRow.productId,
    plan,
    repository,
    context,
  };
}

async function persistCheck(
  run: RepairRun,
  productId: string,
  result: Awaited<ReturnType<Validator["run"]>>,
) {
  const diagnostics = result.results
    .filter((item) => item.status === "failed")
    .map((item) => `${item.id}: ${item.details ?? item.name}`)
    .join("\n");
  const [stored] = await db
    .insert(schema.checkRuns)
    .values({
      id: newId("check"),
      tenantId: run.tenantId,
      repairRunId: run.id,
      attempt: run.attempt,
      commitSha: result.commit_sha,
      validatorVersion: result.validator_version,
      status: result.status,
      results: result.results,
      diagnostics: diagnostics || null,
      startedAt: new Date(result.started_at),
      finishedAt: new Date(result.finished_at),
    })
    .returning();
  await emitRepairEvent({
    type: "checks.completed",
    tenantId: run.tenantId,
    productId,
    correlationId: run.id,
    idempotencyKey: `${run.id}:checks:${run.attempt}`,
    payload: {
      repair_run_id: run.id,
      finding_id: run.findingId,
      check_run_id: stored.id,
      commit_sha: result.commit_sha,
    },
  });
  return { stored, diagnostics };
}

async function blocked(run: RepairRun, productId: string, reason: string) {
  const payload = workflowBlockedPayload.parse({ repair_run_id: run.id, reason });
  const updated = await transition(run.id, "blocked", { blockedReason: reason });
  await emitRepairEvent({
    type: "workflow.blocked",
    tenantId: run.tenantId,
    productId,
    correlationId: run.id,
    idempotencyKey: `${run.id}:blocked:${reason}`,
    payload,
  });
  return updated;
}

function prBody(
  findingRow: Finding,
  plan: StudyPlan,
  checks: Awaited<ReturnType<Validator["run"]>>,
  issueNumber: number,
  repairRunId: string,
) {
  const table = checks.results
    .map((result) => `| ${result.name} | ${result.status} | ${result.details ?? ""} |`)
    .join("\n");
  return `${renderIssueBody(findingRow, plan, null)}

## Functional checks
| Check | Status | Details |
| --- | --- | --- |
${table}

## Human evidence
${plan.automation.mode === "prototype_and_retest" ? "none yet — retest pending" : "not part of this mode"}

Refs #${issueNumber}
<!-- vibecheck:repair=${repairRunId} -->`;
}

type CandidateStep = {
  output: RepairOutput;
  handle: ProviderHandle;
  candidateSha: string;
};

async function obtainCandidate(
  run: RepairRun,
  attempt: number,
  loaded: Awaited<ReturnType<typeof loadContext>>,
  provider: RepairProvider,
  publisher: RepoPublisher,
  handle: ProviderHandle,
  retryDiagnostics: string | null,
  previousCommitSha: string | null,
): Promise<StepResult<CandidateStep>> {
  if (attempt > 1 && !run.devinSessionId) return { kind: "failed", reason: "session_lost" };
  const result =
    attempt === 1
      ? await provider.start(loaded.context, async (session) => {
          handle = session;
          await db
            .update(schema.repairRuns)
            .set({
              devinSessionId: session.sessionId ?? null,
              devinSessionUrl: session.url ?? null,
            })
            .where(eq(schema.repairRuns.id, run.id));
        })
      : await provider.revise(
          handle,
          retryDiagnostics ?? "Continue the repair run and return the structured output.",
        );
  handle = result.handle;
  const output = outputOrThrow(result.raw, run.id);
  await db
    .update(schema.repairRuns)
    .set({ lastOutput: result.raw })
    .where(eq(schema.repairRuns.id, run.id));
  if (output.outcome === "cannot_reproduce") {
    return { kind: "blocked", reason: "not_reproduced" };
  }
  if (output.outcome === "out_of_scope") return { kind: "blocked", reason: "out_of_scope" };
  if (!output.branch) return { kind: "failed", reason: "branch_missing" };
  const branchResult = await withGithub(() =>
    publisher.getBranchSha(loaded.repository, output.branch as string),
  );
  if (branchResult.kind !== "ok") return branchResult;
  if (!branchResult.value) return { kind: "failed", reason: "branch_not_found" };
  if (branchResult.value === run.baseCommitSha) {
    return { kind: "failed", reason: "candidate_same_as_base" };
  }
  if (previousCommitSha && branchResult.value === previousCommitSha) {
    return { kind: "failed", reason: "candidate_unchanged" };
  }
  return {
    kind: "ok",
    value: { output, handle, candidateSha: branchResult.value },
  };
}

async function validateCandidate(
  run: RepairRun,
  loaded: Awaited<ReturnType<typeof loadContext>>,
  publisher: RepoPublisher,
  validator: Validator,
  candidateSha: string,
): Promise<StepResult<Awaited<ReturnType<Validator["run"]>>>> {
  const files = await withGithub(() =>
    publisher.compareFiles(loaded.repository, run.baseCommitSha, candidateSha),
  );
  if (files.kind !== "ok") return files;
  return {
    kind: "ok",
    value: await validator.run({
      repo: loaded.repository,
      baseCommitSha: run.baseCommitSha,
      candidateCommitSha: candidateSha,
      allowedPaths: loaded.context.allowedPaths,
      changedPaths: files.value,
    }),
  };
}

async function openDraftPullRequest(
  run: RepairRun,
  loaded: Awaited<ReturnType<typeof loadContext>>,
  publisher: RepoPublisher,
  checks: Awaited<ReturnType<Validator["run"]>>,
): Promise<StepResult<{ number: number; url: string }>> {
  if (run.pullRequestNumber && run.pullRequestUrl) {
    return { kind: "ok", value: { number: run.pullRequestNumber, url: run.pullRequestUrl } };
  }
  const result = await withGithub(async () => {
    const base = await publisher.getDefaultBranch(loaded.repository);
    return publisher.createDraftPullRequest(loaded.repository, {
      title: loaded.findingRow.title,
      head: run.branch ?? `vibecheck/repair-${run.id}`,
      base,
      body: prBody(loaded.findingRow, loaded.plan, checks, run.issueNumber, run.id),
    });
  });
  return result;
}

async function deployPreview(
  run: RepairRun,
  loaded: Awaited<ReturnType<typeof loadContext>>,
  deployer: PreviewDeployer,
  candidateCommitSha: string,
): Promise<StepResult<{ deploymentId: string; url: string; healthStatus: "healthy" }>> {
  let deployment: Awaited<ReturnType<PreviewDeployer["deploy"]>>;
  try {
    deployment = await deployer.deploy({
      repo: loaded.repository,
      commitSha: candidateCommitSha,
      repairRunId: run.id,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "preview_build_failed" || error.message === "preview_not_found")
    ) {
      return { kind: "blocked", reason: error.message };
    }
    throw error;
  }
  const healthStatus = await deployer.health(deployment.url);
  if (healthStatus !== "healthy") return { kind: "blocked", reason: "preview_unhealthy" };
  return { kind: "ok", value: { ...deployment, healthStatus } };
}

export async function runRepair(repairRunId: string, deps: RepairDeps = {}, tenantId?: string) {
  let [run] = await db
    .select()
    .from(schema.repairRuns)
    .where(
      tenantId
        ? and(eq(schema.repairRuns.id, repairRunId), eq(schema.repairRuns.tenantId, tenantId))
        : eq(schema.repairRuns.id, repairRunId),
    )
    .limit(1);
  if (!run) throw new Error("repair_run_not_found");
  if (["preview_ready", "draft_pr_ready", "blocked", "failed", "cancelled"].includes(run.status)) {
    return toRepairRunContract(run);
  }
  const [existingPreview] = await db
    .select()
    .from(schema.previews)
    .where(eq(schema.previews.repairRunId, run.id))
    .limit(1);
  if (existingPreview) {
    const ready = await transition(run.id, "preview_ready", { previewId: existingPreview.id });
    return toRepairRunContract(ready);
  }
  const provider = deps.provider ?? providerFor();
  const validator = deps.validator ?? validatorFor();
  const deployer = deps.deployer ?? deployerFor();
  const publisher =
    deps.publisher ??
    (env().ISSUE_PUBLISHER === "memory" ? memoryIssuePublisher : githubIssuePublisher);
  const loaded = await loadContext(run);
  const repo = loaded.repository;

  await transition(run.id, "preparing");
  const base = await ensureBaseCommit(publisher, repo, run.baseCommitSha);
  if (base.kind !== "ok") {
    const terminal =
      base.kind === "blocked"
        ? await blocked(run, loaded.productId, base.reason)
        : await transition(run.id, "failed", { blockedReason: base.reason });
    return toRepairRunContract(terminal);
  }
  let handle: ProviderHandle = {
    sessionId: run.devinSessionId ?? undefined,
    url: run.devinSessionUrl ?? undefined,
  };
  let checks: Awaited<ReturnType<Validator["run"]>> | null = null;
  let retryDiagnostics: string | null = null;
  let previousCommitSha: string | null = null;
  while (run.attempt <= run.maxAttempts) {
    const [existingCheck] = await db
      .select()
      .from(schema.checkRuns)
      .where(
        and(eq(schema.checkRuns.repairRunId, run.id), eq(schema.checkRuns.attempt, run.attempt)),
      )
      .orderBy(desc(schema.checkRuns.createdAt))
      .limit(1);
    if (existingCheck && run.candidateCommitSha) {
      checks = {
        validator_version: existingCheck.validatorVersion,
        commit_sha: existingCheck.commitSha,
        status: existingCheck.status,
        results: existingCheck.results,
        started_at: existingCheck.startedAt.toISOString(),
        finished_at: existingCheck.finishedAt.toISOString(),
      };
    } else {
      await transition(run.id, run.attempt === 1 ? "reproducing" : "implementing");
      const candidate = await obtainCandidate(
        run,
        run.attempt,
        loaded,
        provider,
        publisher,
        handle,
        retryDiagnostics,
        previousCommitSha,
      );
      retryDiagnostics = null;
      if (candidate.kind !== "ok") {
        const terminal =
          candidate.kind === "blocked"
            ? await blocked(run, loaded.productId, candidate.reason)
            : await transition(run.id, "failed", { blockedReason: candidate.reason });
        return toRepairRunContract(terminal);
      }
      handle = candidate.value.handle;
      if (handle.sessionId || handle.url) {
        run = {
          ...run,
          devinSessionId: handle.sessionId ?? run.devinSessionId,
          devinSessionUrl: handle.url ?? run.devinSessionUrl,
        };
      }
      await transition(run.id, "implementing");
      await db
        .update(schema.repairRuns)
        .set({
          candidateCommitSha: candidate.value.candidateSha,
          devinSessionId: handle.sessionId ?? run.devinSessionId ?? null,
          devinSessionUrl: handle.url ?? run.devinSessionUrl ?? null,
        })
        .where(eq(schema.repairRuns.id, run.id));
      previousCommitSha = candidate.value.candidateSha;
      run = { ...run, candidateCommitSha: candidate.value.candidateSha };
      const candidatePayload = repairCandidateReadyPayload.parse({
        repair_run_id: run.id,
        finding_id: run.findingId,
        candidate_commit_sha: candidate.value.candidateSha,
      });
      await emitRepairEvent({
        type: "repair.candidate_ready",
        tenantId: run.tenantId,
        productId: loaded.productId,
        correlationId: run.id,
        idempotencyKey: `${run.id}:candidate:${run.attempt}`,
        payload: candidatePayload,
      });
      await transition(run.id, "validating");
      const validation = await validateCandidate(
        run,
        loaded,
        publisher,
        validator,
        candidate.value.candidateSha,
      );
      if (validation.kind !== "ok") {
        const terminal =
          validation.kind === "blocked"
            ? await blocked(run, loaded.productId, validation.reason)
            : await transition(run.id, "failed", { blockedReason: validation.reason });
        return toRepairRunContract(terminal);
      }
      checks = validation.value;
      const persisted = await persistCheck(run, loaded.productId, checks);
      checksCompletedPayload.parse({
        repair_run_id: run.id,
        finding_id: run.findingId,
        check_run_id: persisted.stored.id,
        commit_sha: checks.commit_sha,
      });
    }
    if (checks.status === "failed" || checks.status === "error") {
      if (run.attempt >= run.maxAttempts)
        return toRepairRunContract(await blocked(run, loaded.productId, "checks_failed"));
      await transition(run.id, "retrying");
      retryDiagnostics = checks.results
        .map((result) => `${result.id}: ${result.details ?? result.status}`)
        .join("\n");
      previousCommitSha = checks.commit_sha;
      const retried = await transition(run.id, "implementing", {
        attempt: run.attempt + 1,
        candidateCommitSha: null,
      });
      if (!retried) throw new Error("repair_run_transition_failed");
      run = retried;
      continue;
    }
    break;
  }
  if (!checks || !run.candidateCommitSha)
    return toRepairRunContract(
      await transition(run.id, "failed", { blockedReason: "checks_missing" }),
    );
  const finalChecks = checks;
  const candidateCommitSha = run.candidateCommitSha;
  const pr = await openDraftPullRequest(run, loaded, publisher, finalChecks);
  if (pr.kind !== "ok") {
    const terminal =
      pr.kind === "blocked"
        ? await blocked(run, loaded.productId, pr.reason)
        : await transition(run.id, "failed", { blockedReason: pr.reason });
    return toRepairRunContract(terminal);
  }
  const draftReady = (
    await db
      .update(schema.repairRuns)
      .set({
        pullRequestNumber: pr.value.number,
        pullRequestUrl: pr.value.url,
        status: "draft_pr_ready",
      })
      .where(eq(schema.repairRuns.id, run.id))
      .returning()
  )[0];
  if (!draftReady) throw new Error("repair_run_transition_failed");
  run = draftReady;
  await emitRepairEvent({
    type: "repair.draft_pr_ready",
    tenantId: run.tenantId,
    productId: loaded.productId,
    correlationId: run.id,
    idempotencyKey: `${run.id}:draft_pr_ready`,
    payload: { repair_run_id: run.id, finding_id: run.findingId, pull_request_ref: pr.value.url },
  });
  if (run.mode === "draft_pr" && deployer.name === "fixture") return toRepairRunContract(run);
  await transition(run.id, "deploying");
  const deployment = await deployPreview(run, loaded, deployer, candidateCommitSha);
  if (deployment.kind !== "ok") {
    const terminal =
      deployment.kind === "blocked"
        ? await blocked(run, loaded.productId, deployment.reason)
        : await transition(run.id, "failed", { blockedReason: deployment.reason });
    return toRepairRunContract(terminal);
  }
  const [preview] = await db
    .insert(schema.previews)
    .values({
      id: newId("preview"),
      tenantId: run.tenantId,
      repairRunId: run.id,
      candidateCommitSha,
      provider: deployer.name,
      deploymentId: deployment.value.deploymentId,
      url: deployment.value.url,
      healthStatus: deployment.value.healthStatus,
      fixtureRef: loaded.plan.task.fixture_ref,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    .returning();
  const [ready] = await db
    .update(schema.repairRuns)
    .set({ previewId: preview.id, status: "preview_ready" })
    .where(eq(schema.repairRuns.id, run.id))
    .returning();
  if (deployer.name === "vercel" && run.pullRequestNumber) {
    const marker = `<!-- vibecheck:preview=${candidateCommitSha.slice(0, 7)} -->`;
    if (!(await publisher.findComment(repo, run.pullRequestNumber, marker))) {
      await publisher.comment(
        repo,
        run.pullRequestNumber,
        `Preview (Vercel, candidate ${candidateCommitSha.slice(0, 7)}): ${deployment.value.url}\n${marker}`,
      );
    }
  }
  await emitRepairEvent({
    type: "preview.ready",
    tenantId: run.tenantId,
    productId: loaded.productId,
    correlationId: run.id,
    idempotencyKey: `${run.id}:preview_ready`,
    payload: previewReadyPayload.parse({
      repair_run_id: run.id,
      finding_id: run.findingId,
      candidate_commit_sha: candidateCommitSha,
      preview_url: deployment.value.url,
      fixture_ref: loaded.plan.task.fixture_ref,
      study_id: run.studyId,
      study_revision: run.studyRevision,
    }),
  });
  return toRepairRunContract(ready);
}

export async function getRepairRun(repairRunId: string, tenantId: string) {
  const [run] = await db
    .select()
    .from(schema.repairRuns)
    .where(and(eq(schema.repairRuns.id, repairRunId), eq(schema.repairRuns.tenantId, tenantId)))
    .limit(1);
  if (!run) return null;
  const checks = await db
    .select()
    .from(schema.checkRuns)
    .where(and(eq(schema.checkRuns.repairRunId, run.id), eq(schema.checkRuns.tenantId, tenantId)));
  const [preview] = run.previewId
    ? await db
        .select()
        .from(schema.previews)
        .where(and(eq(schema.previews.id, run.previewId), eq(schema.previews.tenantId, tenantId)))
        .limit(1)
    : [];
  return {
    repair: toRepairRunContract({ ...run, checkRunId: checks.at(-1)?.id }),
    checks,
    preview: preview ?? null,
  };
}
