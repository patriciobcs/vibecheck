import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  finding,
  issuePublishRequest,
  outboxEvent,
  product,
  study,
  studyPlanRevision,
} from "@/db/schema";
import { repoBindingSchema } from "@/contracts/repoBinding";
import type { Finding } from "@/db/schema";
import type { StudyPlan } from "@/contracts/studyPlan";
import type { IssuePublisher } from "@/publishers/types";
import { githubIssuePublisher } from "@/publishers/github";
import { hasGithubCredentials } from "@/publishers/githubAuth";
import { memoryIssuePublisher } from "@/publishers/memory";
import { isPrivateHostname } from "@/lib/destination";

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

export function renderIssueBody(
  row: Finding,
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
1. Open the tested version.
2. Follow the neutral task above.
3. Observe the reported effect without using session-specific content.

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
${dashboardUrl ? `- Dashboard: ${dashboardUrl}` : ""}
`;
}

export function publicDashboardUrl(): string | null {
  const configured = process.env.APP_BASE_URL?.trim();
  if (!configured) return null;
  try {
    const parsed = new URL(configured);
    if (!["http:", "https:"].includes(parsed.protocol) || isPrivateHostname(parsed.hostname)) {
      return null;
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function readableCertainty(value: string) {
  return value.replace(/_/g, " ");
}

function publisherFor(publisher?: IssuePublisher) {
  if (publisher) return publisher;
  if (process.env.ISSUE_PUBLISHER === "memory") return memoryIssuePublisher;
  return githubIssuePublisher;
}

export async function publishFinding(
  findingId: string,
  publisher?: IssuePublisher,
  tenantId?: string,
) {
  const [row] = await db
    .select()
    .from(finding)
    .where(
      tenantId
        ? and(eq(finding.id, findingId), eq(finding.tenantId, tenantId))
        : eq(finding.id, findingId),
    )
    .limit(1);
  if (!row) throw new Error("finding_not_found");
  const [studyRow] = await db
    .select()
    .from(study)
    .where(and(eq(study.id, row.studyId), eq(study.tenantId, row.tenantId)))
    .limit(1);
  if (!studyRow) throw new Error("study_not_found");
  const [planRow] = await db
    .select()
    .from(studyPlanRevision)
    .where(
      and(
        eq(studyPlanRevision.studyId, studyRow.id),
        eq(studyPlanRevision.revision, studyRow.currentRevision),
      ),
    )
    .limit(1);
  if (!planRow) throw new Error("study_plan_not_found");
  const [productRow] = await db
    .select()
    .from(product)
    .where(and(eq(product.id, studyRow.productId), eq(product.tenantId, row.tenantId)))
    .limit(1);
  if (!productRow) throw new Error("product_not_found");
  const key = `finding:${row.id}:observed:${row.observedSessionCount}`;
  const [existing] = await db
    .select()
    .from(issuePublishRequest)
    .where(
      and(
        eq(issuePublishRequest.tenantId, row.tenantId),
        eq(issuePublishRequest.idempotencyKey, key),
      ),
    )
    .limit(1);
  if (existing) return existing;
  const recordSkipped = async (skipReason: "github_disconnected" | "no_token") => {
    const [skipped] = await db
      .insert(issuePublishRequest)
      .values({
        tenantId: row.tenantId,
        findingId: row.id,
        idempotencyKey: key,
        action: "skipped",
        skipReason,
      })
      .returning();
    return skipped;
  };
  const binding = repoBindingSchema.safeParse(productRow.repoBinding);
  if (!binding.success || binding.data.provider !== "github" || !binding.data.issues_enabled) {
    return recordSkipped("github_disconnected");
  }
  const githubBinding = binding.data;
  if (!publisher && !hasGithubCredentials() && process.env.ISSUE_PUBLISHER !== "memory") {
    return recordSkipped("no_token");
  }
  const issuePublisher = publisherFor(publisher);
  const repo = { owner: githubBinding.owner, repo: githubBinding.repo };
  const marker = `<!-- vibecheck:fingerprint=${row.fingerprint} -->`;
  const existingIssue = await issuePublisher.findByMarker(repo, marker);
  const dashboardUrl = publicDashboardUrl();
  let action: "created" | "updated" | "unchanged";
  let issueNumber: number;
  let issueUrl: string;
  if (existingIssue?.state === "open") {
    const [latest] = await db
      .select()
      .from(issuePublishRequest)
      .where(
        and(
          eq(issuePublishRequest.tenantId, row.tenantId),
          eq(issuePublishRequest.issueNumber, existingIssue.number),
          eq(issuePublishRequest.repoOwner, repo.owner),
          eq(issuePublishRequest.repoName, repo.repo),
          inArray(issuePublishRequest.action, ["created", "updated"]),
        ),
      )
      .orderBy(desc(issuePublishRequest.createdAt))
      .limit(1);
    const unchanged =
      latest &&
      latest.observedSessionCount !== null &&
      latest.observedSessionCount >= row.observedSessionCount &&
      latest.certainty === row.certainty;
    if (unchanged) {
      action = "unchanged";
    } else {
      const certaintyUpdate =
        latest?.certainty && latest.certainty !== row.certainty
          ? `; certainty raised from *${readableCertainty(latest.certainty)}* to *${readableCertainty(row.certainty)}*`
          : "";
      await issuePublisher.comment(
        repo,
        existingIssue.number,
        `**Observed again** — a new session reproduced this finding (now ${row.observedSessionCount} of ${row.eligibleSessionCount} eligible sessions${certaintyUpdate}). Session evidence stays in the VibeCheck dashboard.`,
      );
      action = "updated";
    }
    issueNumber = existingIssue.number;
    issueUrl = existingIssue.url;
  } else {
    const created = await issuePublisher.create(repo, {
      title: sanitizeForPublic(row.title, dashboardUrl),
      body: renderIssueBody(row, planRow.plan, dashboardUrl, existingIssue?.number),
      labels: ["vibecheck", "ux-finding"],
    });
    action = "created";
    issueNumber = created.number;
    issueUrl = created.url;
  }
  await db.transaction(async (tx) => {
    await tx
      .update(finding)
      .set({ issueRepo: `${githubBinding.owner}/${githubBinding.repo}`, issueNumber, issueUrl })
      .where(eq(finding.id, row.id));
    await tx.insert(issuePublishRequest).values({
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
      await tx
        .insert(outboxEvent)
        .values({
          eventId: randomUUID(),
          eventType: action === "created" ? "issue.created" : "issue.updated",
          idempotencyKey: `${row.id}:issue:${row.observedSessionCount}`,
          tenantId: row.tenantId,
          productId: studyRow.productId,
          correlationId: row.id,
          payload: {
            finding_id: row.id,
            issue_ref: {
              provider: "github",
              repo: `${githubBinding.owner}/${githubBinding.repo}`,
              number: issueNumber,
              url: issueUrl,
            },
          },
          occurredAt: new Date(),
        })
        .onConflictDoNothing({ target: outboxEvent.idempotencyKey });
      if (planRow.plan.automation.mode !== "issues_only") {
        await tx
          .insert(outboxEvent)
          .values({
            eventId: randomUUID(),
            eventType: "finding.ready_for_repair",
            idempotencyKey: `${row.id}:ready_for_repair:${row.observedSessionCount}`,
            tenantId: row.tenantId,
            productId: studyRow.productId,
            correlationId: row.id,
            payload: {
              finding_id: row.id,
              issue_ref: {
                provider: "github",
                repo: `${githubBinding.owner}/${githubBinding.repo}`,
                number: issueNumber,
                url: issueUrl,
              },
            },
            occurredAt: new Date(),
          })
          .onConflictDoNothing({ target: outboxEvent.idempotencyKey });
      }
    }
  });
  return { action, issueNumber, issueUrl };
}
