import { RepoBindingSchema, type StudyPlan, StudyPlanSchema } from "@vibecheck/contracts";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { env } from "@/lib/env";
import { newId } from "@/lib/ids";
import { publicDashboardUrl } from "@/lib/public-url";
import { hasGithubCredentials } from "@/providers/github/auth";
import { githubIssuePublisher } from "@/providers/github/github";
import { memoryIssuePublisher } from "@/providers/github/memory";
import type { IssuePublisher } from "@/providers/github/types";
import { emitEvent } from "./events";
import { enqueueRepair } from "./repairs";

export function sanitizeForPublic(text: string, dashboardUrl: string | null) {
  return text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]")
    .replace(/https?:\/\/[^\s)]+/gi, (url) =>
      dashboardUrl && url.startsWith(dashboardUrl) ? url : "[redacted url]",
    )
    .replace(/\bsession[_-][A-Za-z0-9_-]+\b/gi, "[redacted session]")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      "[redacted id]",
    )
    .replace(/\b(?:sk-|ghp_|Bearer\s+)[A-Za-z0-9._-]+/gi, "[redacted secret]");
}

export function renderReproductionSteps(_finding: typeof schema.findings.$inferSelect) {
  return [
    "1. Open the tested version.",
    "2. Follow the neutral task above.",
    "3. Observe the reported effect without using session-specific content.",
  ];
}

export function renderIssueBody(
  row: typeof schema.findings.$inferSelect,
  plan: StudyPlan,
  dashboardUrl: string | null,
  recurrence?: number,
) {
  const marker = `<!-- vibecheck:fingerprint=${row.fingerprint} -->`;
  const provenance =
    row.provenance === "human_session"
      ? "human session"
      : "simulated/fixture session, not human evidence";
  return `${marker}
## VibeCheck finding

${
  recurrence
    ? `This is a recurrence of #${recurrence}.

`
    : ""
}### Problem
${sanitizeForPublic(row.observation, dashboardUrl)}

### Hypothesis
${sanitizeForPublic(row.hypothesis, dashboardUrl)}

### Task context
- Participant prompt: ${sanitizeForPublic(plan.task.participant_prompt, dashboardUrl)}
- Research question: ${sanitizeForPublic(plan.task.research_question, dashboardUrl)}
- Tested version: ${sanitizeForPublic(row.baselineCommitSha, dashboardUrl)}

### Safe reproduction
${renderReproductionSteps(row).join("\n")}

### Evidence
- Observed sessions: ${row.observedSessionCount}
- Eligible sessions: ${row.eligibleSessionCount}
- Certainty: ${row.certainty}
- Impact: ${row.impact}
- Provenance: ${provenance}

### Limitations
${row.limitations.map((item) => `- ${sanitizeForPublic(item, dashboardUrl)}`).join("\n")}

### Proposed experiment
${sanitizeForPublic(row.suggestedExperiment ?? "No experiment proposed.", dashboardUrl)}

### Automation
- Mode: ${plan.automation.mode}
${dashboardUrl ? `- Dashboard: ${dashboardUrl}` : ""}`;
}

function publisherFor(publisher?: IssuePublisher) {
  if (publisher) return publisher;
  return env().ISSUE_PUBLISHER === "memory" ? memoryIssuePublisher : githubIssuePublisher;
}

function readableCertainty(value: string) {
  return value.replace(/_/g, " ");
}

export async function publishFinding(
  findingId: string,
  publisher?: IssuePublisher,
  tenantId?: string,
) {
  const row = await db.query.findings.findFirst({
    where: tenantId
      ? and(eq(schema.findings.id, findingId), eq(schema.findings.tenantId, tenantId))
      : eq(schema.findings.id, findingId),
  });
  if (!row) throw new Error("finding_not_found");
  const study = await db.query.studies.findFirst({
    where: and(eq(schema.studies.id, row.studyId), eq(schema.studies.tenantId, row.tenantId)),
  });
  if (!study) throw new Error("study_not_found");
  const revision = await db.query.studyRevisions.findFirst({
    where: and(
      eq(schema.studyRevisions.studyId, study.id),
      eq(schema.studyRevisions.revision, study.currentRevision),
    ),
  });
  if (!revision) throw new Error("study_plan_not_found");
  const product = await db.query.products.findFirst({
    where: and(eq(schema.products.id, study.productId), eq(schema.products.tenantId, row.tenantId)),
  });
  if (!product) throw new Error("product_not_found");
  const key = `finding:${row.id}:observed:${row.observedSessionCount}`;
  const existingRequest = await db.query.issuePublishRequests.findFirst({
    where: and(
      eq(schema.issuePublishRequests.tenantId, row.tenantId),
      eq(schema.issuePublishRequests.idempotencyKey, key),
    ),
  });
  if (existingRequest) return existingRequest;
  const recordSkipped = async (reason: string) => {
    const [record] = await db
      .insert(schema.issuePublishRequests)
      .values({
        id: newId("issuepub"),
        tenantId: row.tenantId,
        findingId: row.id,
        idempotencyKey: key,
        action: "skipped",
        skipReason: reason,
      })
      .returning();
    return record;
  };
  const binding = RepoBindingSchema.safeParse(product.repoBinding);
  if (!binding.success || binding.data.provider !== "github" || !binding.data.issues_enabled)
    return recordSkipped("github_disconnected");
  if (!publisher && !hasGithubCredentials() && env().ISSUE_PUBLISHER !== "memory")
    return recordSkipped("no_token");
  const repo = { owner: binding.data.owner, repo: binding.data.repo };
  const issuePublisher = publisherFor(publisher);
  const marker = `<!-- vibecheck:fingerprint=${row.fingerprint} -->`;
  const found = await issuePublisher.findByMarker(repo, marker);
  const dashboard = publicDashboardUrl();
  let action: "created" | "updated" | "unchanged";
  let issueNumber: number;
  let issueUrl: string;
  if (found?.state === "open") {
    const latest = await db.query.issuePublishRequests.findFirst({
      where: and(
        eq(schema.issuePublishRequests.tenantId, row.tenantId),
        eq(schema.issuePublishRequests.issueNumber, found.number),
        eq(schema.issuePublishRequests.repoOwner, repo.owner),
        eq(schema.issuePublishRequests.repoName, repo.repo),
        inArray(schema.issuePublishRequests.action, ["created", "updated"]),
      ),
      orderBy: desc(schema.issuePublishRequests.createdAt),
    });
    const unchanged =
      latest &&
      latest.observedSessionCount !== null &&
      latest.observedSessionCount >= row.observedSessionCount &&
      latest.certainty === row.certainty;
    if (unchanged) action = "unchanged";
    else {
      const certaintyUpdate =
        latest?.certainty && latest.certainty !== row.certainty
          ? `; certainty raised from *${readableCertainty(latest.certainty)}* to *${readableCertainty(row.certainty)}*`
          : "";
      await issuePublisher.comment(
        repo,
        found.number,
        `**Observed again** — a new session reproduced this finding (now ${row.observedSessionCount} of ${row.eligibleSessionCount} eligible sessions${certaintyUpdate}). Session evidence stays in the VibeCheck dashboard.`,
      );
      action = "updated";
    }
    issueNumber = found.number;
    issueUrl = found.url;
  } else {
    const created = await issuePublisher.create(repo, {
      title: sanitizeForPublic(row.title, dashboard),
      body: renderIssueBody(row, StudyPlanSchema.parse(revision.plan), dashboard, found?.number),
      labels: ["vibecheck", "ux-finding"],
    });
    action = "created";
    issueNumber = created.number;
    issueUrl = created.url;
  }
  await db.transaction(async (tx) => {
    await tx
      .update(schema.findings)
      .set({
        issueRepo: `${repo.owner}/${repo.repo}`,
        issueNumber,
        issueUrl,
        updatedAt: new Date(),
      })
      .where(eq(schema.findings.id, row.id));
    await tx.insert(schema.issuePublishRequests).values({
      id: newId("issuepub"),
      tenantId: row.tenantId,
      findingId: row.id,
      idempotencyKey: key,
      action,
      issueNumber,
      issueUrl,
      observedSessionCount: row.observedSessionCount,
      certainty: row.certainty,
      repoOwner: repo.owner,
      repoName: repo.repo,
    });
    if (action !== "unchanged") {
      await emitEvent(tx, {
        type: action === "created" ? "issue.created" : "issue.updated",
        tenantId: row.tenantId,
        productId: study.productId,
        correlationId: row.id,
        idempotencyKey: `${row.id}:issue:${row.observedSessionCount}`,
        payload: {
          finding_id: row.id,
          issue_ref: {
            provider: "github",
            repo: `${repo.owner}/${repo.repo}`,
            number: issueNumber,
            url: issueUrl,
          },
        },
      });
      const plan = StudyPlanSchema.parse(revision.plan);
      if (plan.automation.mode !== "issues_only") {
        await emitEvent(tx, {
          type: "finding.ready_for_repair",
          tenantId: row.tenantId,
          productId: study.productId,
          correlationId: row.id,
          idempotencyKey: `${row.id}:ready_for_repair:${row.observedSessionCount}`,
          payload: {
            finding_id: row.id,
            issue_ref: {
              provider: "github",
              repo: `${repo.owner}/${repo}`,
              number: issueNumber,
              url: issueUrl,
            },
          },
        });
        await enqueueRepair(
          tx,
          row,
          {
            repo: `${repo.owner}/${repo.repo}`,
            number: issueNumber,
            url: issueUrl,
          },
          plan,
        );
      }
    }
  });
  return { action, issueNumber, issueUrl };
}
