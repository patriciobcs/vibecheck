import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import type { Tx } from "@/db";
import {
  checkRun as checkRunTable,
  finding,
  job,
  outboxEvent,
  preview as previewTable,
  repairRun,
  study,
  studyPlanRevision,
  type Finding,
  type RepairRun,
} from "@/db/schema";
import type { StudyPlan } from "@/contracts/studyPlan";
import { repairOutputSchema, type RepairOutput } from "@/contracts/repairOutput";
import { toRepairRunContract } from "@/contracts/repairRun";
import {
  checksCompletedPayload,
  previewReadyPayload,
  repairCandidateReadyPayload,
  workflowBlockedPayload,
} from "@/contracts/events";
import type { ProviderHandle, ProviderResult } from "@/agents/types";
import { fixtureRepairProvider } from "@/agents/repair/fixture";
import { devinRepairProvider } from "@/agents/repair/devin";
import type { RepairContext, RepairProvider } from "@/agents/repair/types";
import { demoAllowedPaths, demoInvariants } from "@/agents/repair/demoPolicy";
import { fixtureValidator } from "@/validators/fixture";
import type { Validator } from "@/validators/types";
import { fixturePreviewDeployer } from "@/previews/fixture";
import type { PreviewDeployer } from "@/previews/types";
import type { RepoPublisher } from "@/publishers/types";
import { githubIssuePublisher } from "@/publishers/github";
import { renderIssueBody, renderReproductionSteps } from "./issues";

type IssueRef = { repo: string; number: number; url: string };
type RepairDeps = {
  provider?: RepairProvider;
  validator?: Validator;
  deployer?: PreviewDeployer;
  publisher?: RepoPublisher;
};

function providerFor() {
  return process.env.REPAIR_PROVIDER === "devin" ? devinRepairProvider : fixtureRepairProvider;
}

function validatorFor() {
  if (process.env.VALIDATOR && process.env.VALIDATOR !== "fixture") {
    throw new Error(`validator_unavailable_${process.env.VALIDATOR}`);
  }
  return fixtureValidator;
}

function deployerFor() {
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
    .update(repairRun)
    .set({ status, ...values })
    .where(eq(repairRun.id, id))
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
    .insert(repairRun)
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
      validatorVersion:
        process.env.VALIDATOR === "fixture" || !process.env.VALIDATOR
          ? "fixture_validator_v1"
          : process.env.VALIDATOR,
    })
    .onConflictDoNothing({ target: repairRun.findingId })
    .returning();
  if (!created) return null;
  await tx.insert(job).values({
    type: "repair.run",
    tenantId: row.tenantId,
    payload: { repairRunId: created.id },
  });
  return created;
}

async function loadContext(run: RepairRun) {
  const [findingRow] = await db
    .select()
    .from(finding)
    .where(eq(finding.id, run.findingId))
    .limit(1);
  if (!findingRow) throw new Error("finding_not_found");
  const [studyRow] = await db.select().from(study).where(eq(study.id, run.studyId)).limit(1);
  if (!studyRow) throw new Error("study_not_found");
  const [planRow] = await db
    .select()
    .from(studyPlanRevision)
    .where(
      and(
        eq(studyPlanRevision.studyId, run.studyId),
        eq(studyPlanRevision.revision, run.studyRevision),
      ),
    )
    .limit(1);
  if (!planRow) throw new Error("study_plan_not_found");
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
      reproductionSteps: renderReproductionSteps(findingRow),
    },
    task: {
      participant_prompt: planRow.plan.task.participant_prompt,
      success_rule_ref: planRow.plan.task.success_rule_ref,
    },
    allowedPaths: demoAllowedPaths,
    invariants: demoInvariants,
  };
  return {
    findingRow,
    studyRow,
    productId: studyRow.productId,
    plan: planRow.plan,
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
    .insert(checkRunTable)
    .values({
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
  await db
    .insert(outboxEvent)
    .values({
      eventId: randomUUID(),
      eventType: "checks.completed",
      idempotencyKey: `${run.id}:checks:${run.attempt}`,
      tenantId: run.tenantId,
      productId,
      correlationId: run.id,
      payload: {
        repair_run_id: run.id,
        finding_id: run.findingId,
        check_run_id: stored.id,
        commit_sha: result.commit_sha,
      },
      occurredAt: new Date(),
    })
    .onConflictDoNothing({ target: outboxEvent.idempotencyKey });
  return { stored, diagnostics };
}

async function blocked(run: RepairRun, productId: string, reason: string) {
  const payload = workflowBlockedPayload.parse({ repair_run_id: run.id, reason });
  const updated = await transition(run.id, "blocked", { blockedReason: reason });
  await db
    .insert(outboxEvent)
    .values({
      eventId: randomUUID(),
      eventType: "workflow.blocked",
      idempotencyKey: `${run.id}:blocked:${reason}`,
      tenantId: run.tenantId,
      productId,
      correlationId: run.id,
      payload,
      occurredAt: new Date(),
    })
    .onConflictDoNothing({ target: outboxEvent.idempotencyKey });
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
            .update(repairRun)
            .set({
              devinSessionId: session.sessionId ?? null,
              devinSessionUrl: session.url ?? null,
            })
            .where(eq(repairRun.id, run.id));
        })
      : await provider.revise(
          handle,
          retryDiagnostics ?? "Continue the repair run and return the structured output.",
        );
  handle = result.handle;
  const output = outputOrThrow(result.raw, run.id);
  await db.update(repairRun).set({ lastOutput: result.raw }).where(eq(repairRun.id, run.id));
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
  const deployment = await deployer.deploy({
    repo: loaded.repository,
    commitSha: candidateCommitSha,
    repairRunId: run.id,
  });
  const healthStatus = await deployer.health(deployment.url);
  if (healthStatus !== "healthy") return { kind: "blocked", reason: "preview_unhealthy" };
  return { kind: "ok", value: { ...deployment, healthStatus } };
}

export async function runRepair(repairRunId: string, deps: RepairDeps = {}, tenantId?: string) {
  let [run] = await db
    .select()
    .from(repairRun)
    .where(
      tenantId
        ? and(eq(repairRun.id, repairRunId), eq(repairRun.tenantId, tenantId))
        : eq(repairRun.id, repairRunId),
    )
    .limit(1);
  if (!run) throw new Error("repair_run_not_found");
  if (["preview_ready", "draft_pr_ready", "blocked", "failed", "cancelled"].includes(run.status)) {
    return toRepairRunContract(run);
  }
  const [existingPreview] = await db
    .select()
    .from(previewTable)
    .where(eq(previewTable.repairRunId, run.id))
    .limit(1);
  if (existingPreview) {
    const ready = await transition(run.id, "preview_ready", { previewId: existingPreview.id });
    return toRepairRunContract(ready);
  }
  const provider = deps.provider ?? providerFor();
  const validator = deps.validator ?? validatorFor();
  const deployer = deps.deployer ?? deployerFor();
  const publisher = deps.publisher ?? githubIssuePublisher;
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
      .from(checkRunTable)
      .where(and(eq(checkRunTable.repairRunId, run.id), eq(checkRunTable.attempt, run.attempt)))
      .orderBy(desc(checkRunTable.createdAt))
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
        .update(repairRun)
        .set({
          candidateCommitSha: candidate.value.candidateSha,
          devinSessionId: handle.sessionId ?? run.devinSessionId ?? null,
          devinSessionUrl: handle.url ?? run.devinSessionUrl ?? null,
        })
        .where(eq(repairRun.id, run.id));
      previousCommitSha = candidate.value.candidateSha;
      run = { ...run, candidateCommitSha: candidate.value.candidateSha };
      const candidatePayload = repairCandidateReadyPayload.parse({
        repair_run_id: run.id,
        finding_id: run.findingId,
        candidate_commit_sha: candidate.value.candidateSha,
      });
      await db
        .insert(outboxEvent)
        .values({
          eventId: randomUUID(),
          eventType: "repair.candidate_ready",
          idempotencyKey: `${run.id}:candidate:${run.attempt}`,
          tenantId: run.tenantId,
          productId: loaded.productId,
          correlationId: run.id,
          payload: candidatePayload,
          occurredAt: new Date(),
        })
        .onConflictDoNothing({ target: outboxEvent.idempotencyKey });
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
      run = (await transition(run.id, "implementing", {
        attempt: run.attempt + 1,
        candidateCommitSha: null,
      }))!;
      continue;
    }
    break;
  }
  if (!checks || !run.candidateCommitSha)
    return toRepairRunContract(
      await transition(run.id, "failed", { blockedReason: "checks_missing" }),
    );
  const candidateCommitSha = run.candidateCommitSha;
  const pr = await openDraftPullRequest(run, loaded, publisher, checks);
  if (pr.kind !== "ok") {
    const terminal =
      pr.kind === "blocked"
        ? await blocked(run, loaded.productId, pr.reason)
        : await transition(run.id, "failed", { blockedReason: pr.reason });
    return toRepairRunContract(terminal);
  }
  run = (
    await db
      .update(repairRun)
      .set({
        pullRequestNumber: pr.value.number,
        pullRequestUrl: pr.value.url,
        status: "draft_pr_ready",
      })
      .where(eq(repairRun.id, run.id))
      .returning()
  )[0]!;
  await db
    .insert(outboxEvent)
    .values({
      eventId: randomUUID(),
      eventType: "repair.draft_pr_ready",
      idempotencyKey: `${run.id}:draft_pr_ready`,
      tenantId: run.tenantId,
      productId: loaded.productId,
      correlationId: run.id,
      payload: {
        repair_run_id: run.id,
        finding_id: run.findingId,
        pull_request_ref: pr.value.url,
      },
      occurredAt: new Date(),
    })
    .onConflictDoNothing({ target: outboxEvent.idempotencyKey });
  if (run.mode === "draft_pr") return toRepairRunContract(run);
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
    .insert(previewTable)
    .values({
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
    .update(repairRun)
    .set({ previewId: preview.id, status: "preview_ready" })
    .where(eq(repairRun.id, run.id))
    .returning();
  await db
    .insert(outboxEvent)
    .values({
      eventId: randomUUID(),
      eventType: "preview.ready",
      idempotencyKey: `${run.id}:preview_ready`,
      tenantId: run.tenantId,
      productId: loaded.productId,
      correlationId: run.id,
      payload: previewReadyPayload.parse({
        repair_run_id: run.id,
        finding_id: run.findingId,
        candidate_commit_sha: candidateCommitSha,
        preview_url: deployment.value.url,
        fixture_ref: loaded.plan.task.fixture_ref,
        study_id: run.studyId,
        study_revision: run.studyRevision,
      }),
      occurredAt: new Date(),
    })
    .onConflictDoNothing({ target: outboxEvent.idempotencyKey });
  return toRepairRunContract(ready);
}

export async function getRepairRun(repairRunId: string, tenantId: string) {
  const [run] = await db
    .select()
    .from(repairRun)
    .where(and(eq(repairRun.id, repairRunId), eq(repairRun.tenantId, tenantId)))
    .limit(1);
  if (!run) return null;
  const checks = await db
    .select()
    .from(checkRunTable)
    .where(and(eq(checkRunTable.repairRunId, run.id), eq(checkRunTable.tenantId, tenantId)));
  const [preview] = run.previewId
    ? await db
        .select()
        .from(previewTable)
        .where(and(eq(previewTable.id, run.previewId), eq(previewTable.tenantId, tenantId)))
        .limit(1)
    : [];
  return {
    repairRun: toRepairRunContract({ ...run, checkRunId: checks.at(-1)?.id }),
    checks,
    preview: preview ?? null,
  };
}
