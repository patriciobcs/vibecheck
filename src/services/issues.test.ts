import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import {
  finding,
  issuePublishRequest,
  outboxEvent,
  product,
  study,
  studyPlanRevision,
  tenant,
} from "@/db/schema";
import type { Product } from "@/db/schema";
import type { StudyPlan } from "@/contracts/studyPlan";
import { MemoryIssuePublisher } from "@/publishers/memory";
import { publishFinding } from "./issues";

const makePlan = (
  studyId: string,
  productId: string,
  mode: StudyPlan["automation"]["mode"],
): StudyPlan => ({
  schema_version: "1.0",
  study_id: studyId,
  study_revision: 1,
  product_id: productId,
  task: {
    task_id: "task_capture_ideas",
    participant_prompt: "Add an idea to the board.",
    research_question: "Can users add an idea?",
    time_limit_seconds: 300,
    success_rule_ref: "stickynote_capture_v1",
    fixture_ref: "fixture",
  },
  baseline: { commit_sha: "baseline", environment_ref: "fixture" },
  recruitment: {
    source: "marketplace",
    target_count: 1,
    cohort: "fixture",
    eligibility_rule_ref: "eligible_whiteboard_users_v1",
  },
  capture: {
    screen: "required",
    microphone: "off",
    webcam: "off",
    pointer: "on",
    keyboard: "semantic_only",
    text_values: "off",
    retention_days: 1,
  },
  automation: {
    mode,
    max_variants: 0,
    max_repair_attempts: 0,
    agent_budget_ref: "fixture",
    retest_target_count: 0,
  },
});

async function fixture(options: {
  repoBinding?: Product["repoBinding"];
  mode?: StudyPlan["automation"]["mode"];
  observation?: string;
}) {
  const [tenantRow] = await db
    .insert(tenant)
    .values({ name: `issues-${randomUUID()}` })
    .returning();
  const [productRow] = await db
    .insert(product)
    .values({
      tenantId: tenantRow.id,
      name: "Issue test product",
      description: "fixture",
      url: "http://example.com",
      permittedOrigins: [],
      language: "en",
      audience: "testers",
      repoBinding:
        "repoBinding" in options
          ? options.repoBinding
          : { provider: "github", owner: "owner", repo: "repo", issues_enabled: true },
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
  const plan = makePlan(studyRow.id, productRow.id, options.mode ?? "issues_only");
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
      baselineCommitSha: "baseline",
      fingerprint: randomUUID(),
      category: "discoverability",
      semanticTarget: "toolbar.sticky_note",
      observation:
        options.observation ??
        "The participant searched for the note tool before completing the task.",
      hypothesis: "The note tool may be difficult to discover.",
      impact: "task_slowed",
      certainty: "preliminary",
      limitations: ["One fixture session."],
      suggestedExperiment: "Surface the note tool in the main toolbar.",
      evidence: [
        {
          session_id: "session_private",
          segment_ids: ["segment_01"],
          event_ids: ["event_01"],
          start_ms: 0,
          end_ms: 1000,
        },
      ],
      observedSessionCount: 1,
      eligibleSessionCount: 1,
      provenance: "fixture",
    })
    .returning();
  return { tenantRow, productRow, studyRow, findingRow };
}

describe.skipIf(!process.env.DATABASE_URL)("issue publication", () => {
  it("creates an issue, mapping and issue.created event", async () => {
    const data = await fixture({});
    const publisher = new MemoryIssuePublisher();
    const result = await publishFinding(data.findingRow.id, publisher);
    const [event] = await db
      .select()
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.tenantId, data.tenantRow.id),
          eq(outboxEvent.eventType, "issue.created"),
        ),
      );
    const [stored] = await db.select().from(finding).where(eq(finding.id, data.findingRow.id));
    expect({
      action: result.action,
      issueNumber: result.issueNumber,
      mappedNumber: stored?.issueNumber,
      eventType: event?.eventType,
    }).toEqual({ action: "created", issueNumber: 1, mappedNumber: 1, eventType: "issue.created" });
    await db.delete(tenant).where(eq(tenant.id, data.tenantRow.id));
  });

  it("replays the same idempotency key without calling the publisher", async () => {
    const data = await fixture({});
    const publisher = new MemoryIssuePublisher();
    await publishFinding(data.findingRow.id, publisher);
    const replay = await publishFinding(data.findingRow.id, publisher);
    expect({ action: replay.action, createCalls: publisher.createCalls }).toEqual({
      action: "created",
      createCalls: 1,
    });
    await db.delete(tenant).where(eq(tenant.id, data.tenantRow.id));
  });

  it("comments on an existing open issue", async () => {
    const data = await fixture({});
    const publisher = new MemoryIssuePublisher();
    await publishFinding(data.findingRow.id, publisher);
    await db
      .update(finding)
      .set({ observedSessionCount: 2 })
      .where(eq(finding.id, data.findingRow.id));
    const result = await publishFinding(data.findingRow.id, publisher);
    const [event] = await db
      .select()
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.tenantId, data.tenantRow.id),
          eq(outboxEvent.eventType, "issue.updated"),
        ),
      );
    expect({
      action: result.action,
      comments: publisher.comments.length,
      event: event?.eventType,
    }).toEqual({
      action: "updated",
      comments: 1,
      event: "issue.updated",
    });
    await db.delete(tenant).where(eq(tenant.id, data.tenantRow.id));
  });

  it("creates a recurrence issue when the previous issue is closed", async () => {
    const data = await fixture({});
    const publisher = new MemoryIssuePublisher();
    await publishFinding(data.findingRow.id, publisher);
    publisher.issues[0].state = "closed";
    await db
      .update(finding)
      .set({ observedSessionCount: 2 })
      .where(eq(finding.id, data.findingRow.id));
    await publishFinding(data.findingRow.id, publisher);
    expect({ issues: publisher.issues.length, recurrence: publisher.issues[1].body }).toEqual({
      issues: 2,
      recurrence: expect.stringContaining("recurrence of #1"),
    });
    await db.delete(tenant).where(eq(tenant.id, data.tenantRow.id));
  });

  it("sanitizes public issue content", async () => {
    const data = await fixture({
      observation:
        "Contact test@example.com with ghp_xxx. Transcript session_private should stay private.",
    });
    const publisher = new MemoryIssuePublisher();
    await publishFinding(data.findingRow.id, publisher);
    const body = publisher.issues[0].body;
    expect({
      hasTranscript: body.includes("session_private"),
      hasEmail: body.includes("test@example.com"),
      hasToken: body.includes("ghp_xxx"),
      hasRedaction: body.includes("[redacted"),
    }).toEqual({ hasTranscript: false, hasEmail: false, hasToken: false, hasRedaction: true });
    await db.delete(tenant).where(eq(tenant.id, data.tenantRow.id));
  });

  it("emits repair only for automation modes beyond issues_only", async () => {
    const issuesOnly = await fixture({ mode: "issues_only" });
    const issuesPublisher = new MemoryIssuePublisher();
    await publishFinding(issuesOnly.findingRow.id, issuesPublisher);
    const prototype = await fixture({ mode: "prototype_and_retest" });
    const prototypePublisher = new MemoryIssuePublisher();
    await publishFinding(prototype.findingRow.id, prototypePublisher);
    const repairEvents = await db
      .select()
      .from(outboxEvent)
      .where(eq(outboxEvent.eventType, "finding.ready_for_repair"));
    expect(repairEvents.some((event) => event.tenantId === issuesOnly.tenantRow.id)).toBe(false);
    expect(repairEvents.some((event) => event.tenantId === prototype.tenantRow.id)).toBe(true);
    await db.delete(tenant).where(eq(tenant.id, issuesOnly.tenantRow.id));
    await db.delete(tenant).where(eq(tenant.id, prototype.tenantRow.id));
  });

  it("skips disconnected GitHub publication but preserves the finding", async () => {
    const data = await fixture({ repoBinding: null });
    const result = await publishFinding(data.findingRow.id, new MemoryIssuePublisher());
    const [request] = await db
      .select()
      .from(issuePublishRequest)
      .where(eq(issuePublishRequest.findingId, data.findingRow.id));
    const [stored] = await db.select().from(finding).where(eq(finding.id, data.findingRow.id));
    expect({
      action: result.action,
      skipReason: request?.skipReason,
      findingId: stored?.id,
    }).toEqual({
      action: "skipped",
      skipReason: "github_disconnected",
      findingId: data.findingRow.id,
    });
    await db.delete(tenant).where(eq(tenant.id, data.tenantRow.id));
  });

  it("records no_token when GitHub credentials are unavailable", async () => {
    const previousAppId = process.env.GITHUB_APP_ID;
    const previousPrivateKey = process.env.GITHUB_APP_PRIVATE_KEY;
    const previousToken = process.env.GITHUB_ISSUES_TOKEN;
    const previousPublisher = process.env.ISSUE_PUBLISHER;
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    delete process.env.GITHUB_ISSUES_TOKEN;
    process.env.ISSUE_PUBLISHER = "github";
    const data = await fixture({});
    try {
      const result = await publishFinding(data.findingRow.id);
      const [request] = await db
        .select()
        .from(issuePublishRequest)
        .where(eq(issuePublishRequest.findingId, data.findingRow.id));
      expect({ action: result.action, skipReason: request?.skipReason }).toEqual({
        action: "skipped",
        skipReason: "no_token",
      });
    } finally {
      await db.delete(tenant).where(eq(tenant.id, data.tenantRow.id));
      if (previousAppId === undefined) delete process.env.GITHUB_APP_ID;
      else process.env.GITHUB_APP_ID = previousAppId;
      if (previousPrivateKey === undefined) delete process.env.GITHUB_APP_PRIVATE_KEY;
      else process.env.GITHUB_APP_PRIVATE_KEY = previousPrivateKey;
      if (previousToken === undefined) delete process.env.GITHUB_ISSUES_TOKEN;
      else process.env.GITHUB_ISSUES_TOKEN = previousToken;
      if (previousPublisher === undefined) delete process.env.ISSUE_PUBLISHER;
      else process.env.ISSUE_PUBLISHER = previousPublisher;
    }
  });

  it("retains findings for a local repository binding", async () => {
    const data = await fixture({
      repoBinding: { provider: "local", path: "/Users/devin/repos/excalidraw" },
    });
    const result = await publishFinding(data.findingRow.id, new MemoryIssuePublisher());
    const [request] = await db
      .select()
      .from(issuePublishRequest)
      .where(eq(issuePublishRequest.findingId, data.findingRow.id));
    const [stored] = await db.select().from(finding).where(eq(finding.id, data.findingRow.id));
    expect({
      action: result.action,
      skipReason: request?.skipReason,
      findingId: stored?.id,
    }).toEqual({
      action: "skipped",
      skipReason: "github_disconnected",
      findingId: data.findingRow.id,
    });
    await db.delete(tenant).where(eq(tenant.id, data.tenantRow.id));
  });
});
