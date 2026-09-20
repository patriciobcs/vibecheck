import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import {
  analysisRun,
  apiKey,
  experimentSummary,
  finding,
  participationEvent as participationEventTable,
  product,
  study,
  studyPlanRevision,
  tenant,
} from "@/db/schema";
import { evidencePackageSchema } from "@/contracts/evidencePackage";
import { recordParticipation } from "./participation";
import { computeDeterministic, generateSummary } from "./summaries";
import type { SummaryProvider } from "@/agents/summary/types";
import { hashApiKey } from "@/lib/auth";
import { GET as getSummary } from "@/app/api/studies/[id]/summary/route";

const baseline = "baseline";

function plan(studyId: string, productId: string) {
  return {
    schema_version: "1.0" as const,
    study_id: studyId,
    study_revision: 1,
    product_id: productId,
    task: {
      task_id: "task",
      participant_prompt: "Complete the task.",
      research_question: "Can participants complete the task?",
      time_limit_seconds: 300,
      success_rule_ref: "success",
      fixture_ref: "fixture",
    },
    baseline: { commit_sha: baseline, environment_ref: "fixture" },
    recruitment: {
      source: "direct_link" as const,
      target_count: 2,
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
      mode: "issues_only" as const,
      max_variants: 0,
      max_repair_attempts: 0,
      agent_budget_ref: "fixture",
      retest_target_count: 0,
    },
  };
}

async function fixture() {
  const [tenantRow] = await db.insert(tenant).values({ name: randomUUID() }).returning();
  const [productRow] = await db
    .insert(product)
    .values({
      tenantId: tenantRow.id,
      name: "Summary product",
      description: "fixture",
      url: "https://example.com",
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
  await db.insert(studyPlanRevision).values({
    studyId: studyRow.id,
    revision: 1,
    plan: plan(studyRow.id, productRow.id),
    publishedAt: new Date(),
  });
  return { tenantRow, productRow, studyRow };
}

function evidence(sessionId: string, outcome: "completed" | "stuck" = "completed") {
  return evidencePackageSchema.parse({
    schema_version: "1.0",
    evidence_package_id: `evidence-${sessionId}`,
    session_id: sessionId,
    study_id: "study",
    study_revision: 1,
    baseline_commit_sha: baseline,
    task: {
      task_id: "task",
      participant_prompt: "Complete the task.",
      research_question: "Can participants complete the task?",
      time_limit_seconds: 300,
      success_rule_ref: "success",
      fixture_ref: "fixture",
    },
    outcome: { participant_reported: outcome, instrumented: "completed" },
    completeness: "complete",
    instrumentation: "sdk",
    session_duration_ms: 1000,
    events: [],
    events_truncated: false,
    transcript: [],
    transcript_truncated: false,
    media: [],
    provenance: "fixture",
  });
}

async function addAnalysis(
  data: Awaited<ReturnType<typeof fixture>>,
  sessionId: string,
  outcome: "completed" | "stuck" = "completed",
) {
  await db.insert(analysisRun).values({
    tenantId: data.tenantRow.id,
    studyId: data.studyRow.id,
    sessionId,
    status: "completed",
    provider: "fixture",
    outcome: "findings",
    evidencePackage: evidence(sessionId, outcome),
    rawResponses: [],
  });
}

async function addFinding(
  data: Awaited<ReturnType<typeof fixture>>,
  title: string,
  observed: number,
) {
  const [row] = await db
    .insert(finding)
    .values({
      tenantId: data.tenantRow.id,
      studyId: data.studyRow.id,
      studyRevision: 1,
      baselineCommitSha: baseline,
      title,
      fingerprint: randomUUID(),
      category: "discoverability",
      semanticTarget: "toolbar",
      observation: `Observed ${title}.`,
      hypothesis: "The interface may be difficult to use.",
      impact: "task_slowed",
      certainty: observed > 1 ? "repeated_observation" : "preliminary",
      limitations: ["Fixture sample."],
      suggestedExperiment: "Try a clearer affordance.",
      evidence: [],
      observedSessionCount: observed,
      eligibleSessionCount: 2,
      provenance: "fixture",
    })
    .returning();
  return row;
}

const validProvider = (studyId: string, findingId: string): SummaryProvider => ({
  name: "test",
  async summarize() {
    return {
      raw: {
        schema_version: "1.0",
        study_id: studyId,
        headline: "Participants found recurring usability themes",
        observations: [
          { text: "A recurring theme was observed.", finding_ids: [findingId] },
          { text: "The theme affected task progress.", finding_ids: [findingId] },
          { text: "More evidence is needed.", finding_ids: [findingId] },
        ],
        limitations: ["Fixture evidence."],
      },
      handle: {},
    };
  },
  async requestCorrection(handle) {
    return { raw: null, handle };
  },
});

describe.skipIf(!process.env.DATABASE_URL)("experiment summaries", () => {
  it("stores collecting when no sessions are eligible", async () => {
    const data = await fixture();
    const summary = await generateSummary(data.tenantRow.id, data.studyRow.id, 1);
    expect({ status: summary.status, eligible: summary.summary.sessions.eligible }).toEqual({
      status: "collecting",
      eligible: 0,
    });
    await db.delete(tenant).where(eq(tenant.id, data.tenantRow.id));
  });

  it("summarizes fixture findings with funnel counts and sorted themes", async () => {
    const data = await fixture();
    await addAnalysis(data, "session-1");
    await addAnalysis(data, "session-2", "stuck");
    const first = await addFinding(data, "Zed: later theme", 1);
    const second = await addFinding(data, "Alpha: leading theme", 2);
    await recordParticipation(data.tenantRow.id, data.studyRow.id, {
      schema_version: "1.0",
      event_id: randomUUID(),
      study_id: data.studyRow.id,
      study_revision: 1,
      participant_ref: "p1",
      kind: "invited",
      occurred_at: new Date().toISOString(),
      session_id: null,
    });
    await recordParticipation(data.tenantRow.id, data.studyRow.id, {
      schema_version: "1.0",
      event_id: randomUUID(),
      study_id: data.studyRow.id,
      study_revision: 1,
      participant_ref: "p1",
      kind: "completed",
      occurred_at: new Date().toISOString(),
      session_id: "session-1",
    });
    const summary = await generateSummary(data.tenantRow.id, data.studyRow.id, 1, {
      provider: validProvider(data.studyRow.id, second.id),
    });
    expect({
      status: summary.status,
      provenance: summary.summary.provenance,
      invited: summary.summary.participation.invited,
      completed: summary.summary.sessions.outcomes.completed,
      themes: summary.summary.themes.map((theme) => theme.title),
      firstId: first.id,
    }).toEqual({
      status: "summarized",
      provenance: "fixture",
      invited: 1,
      completed: 1,
      themes: ["Alpha: leading theme", "Zed: later theme"],
      firstId: first.id,
    });
    await db.delete(tenant).where(eq(tenant.id, data.tenantRow.id));
  });

  it("reuses an identical input hash and creates a new revision after participation changes", async () => {
    const data = await fixture();
    await addAnalysis(data, "session-1");
    const row = await addFinding(data, "Toolbar: repeated issue", 1);
    const first = await generateSummary(data.tenantRow.id, data.studyRow.id, 1, {
      provider: validProvider(data.studyRow.id, row.id),
    });
    const replay = await generateSummary(data.tenantRow.id, data.studyRow.id, 1, {
      provider: validProvider(data.studyRow.id, row.id),
    });
    expect(replay.id).toBe(first.id);
    await recordParticipation(data.tenantRow.id, data.studyRow.id, {
      schema_version: "1.0",
      event_id: randomUUID(),
      study_id: data.studyRow.id,
      study_revision: 1,
      participant_ref: "p1",
      kind: "completed",
      occurred_at: new Date().toISOString(),
      session_id: "session-1",
    });
    const next = await generateSummary(data.tenantRow.id, data.studyRow.id, 1, {
      provider: validProvider(data.studyRow.id, row.id),
    });
    expect(next.revision).toBe(first.revision + 1);
    await db.delete(tenant).where(eq(tenant.id, data.tenantRow.id));
  });

  it("fails after one invalid narrative correction while retaining deterministic themes", async () => {
    const data = await fixture();
    await addAnalysis(data, "session-1");
    const row = await addFinding(data, "Toolbar: invalid narrative", 1);
    let corrections = 0;
    const provider: SummaryProvider = {
      name: "invalid",
      async summarize() {
        return {
          raw: {
            schema_version: "1.0",
            study_id: data.studyRow.id,
            headline: "Invalid output",
            observations: [
              { text: "Bad citation.", finding_ids: ["unknown"] },
              { text: "Bad citation.", finding_ids: ["unknown"] },
              { text: "Bad citation.", finding_ids: ["unknown"] },
            ],
            limitations: [],
          },
          handle: {},
        };
      },
      async requestCorrection(handle) {
        corrections += 1;
        return { raw: null, handle };
      },
    };
    const summary = await generateSummary(data.tenantRow.id, data.studyRow.id, 1, { provider });
    expect({
      status: summary.status,
      corrections,
      themes: summary.summary.themes.map((theme) => theme.finding_id),
    }).toEqual({ status: "failed", corrections: 1, themes: [row.id] });
    await db.delete(tenant).where(eq(tenant.id, data.tenantRow.id));
  });

  it("replays participation by event id without a duplicate row", async () => {
    const data = await fixture();
    const event = {
      schema_version: "1.0" as const,
      event_id: randomUUID(),
      study_id: data.studyRow.id,
      study_revision: 1,
      participant_ref: "p1",
      kind: "completed" as const,
      occurred_at: new Date().toISOString(),
      session_id: "session-1",
    };
    expect(await recordParticipation(data.tenantRow.id, data.studyRow.id, event)).toEqual({
      created: true,
    });
    expect(await recordParticipation(data.tenantRow.id, data.studyRow.id, event)).toEqual({
      created: false,
    });
    const rows = await db
      .select()
      .from(participationEventTable)
      .where(
        and(
          eq(participationEventTable.tenantId, data.tenantRow.id),
          eq(participationEventTable.studyId, data.studyRow.id),
        ),
      );
    expect(rows).toHaveLength(1);
    await db.delete(tenant).where(eq(tenant.id, data.tenantRow.id));
  });

  it("denies deterministic reads across tenants", async () => {
    const data = await fixture();
    const other = await fixture();
    await expect(computeDeterministic(other.tenantRow.id, data.studyRow.id, 1)).rejects.toThrow(
      "study_not_found",
    );
    await db.delete(tenant).where(eq(tenant.id, data.tenantRow.id));
    await db.delete(tenant).where(eq(tenant.id, other.tenantRow.id));
  });

  it("denies cross-tenant summary GETs", async () => {
    const data = await fixture();
    const other = await fixture();
    await addAnalysis(data, "session-1");
    const row = await addFinding(data, "Toolbar: protected summary", 1);
    await generateSummary(data.tenantRow.id, data.studyRow.id, 1, {
      provider: validProvider(data.studyRow.id, row.id),
    });
    const key = `key-${randomUUID()}`;
    await db.insert(apiKey).values({
      tenantId: other.tenantRow.id,
      keyHash: hashApiKey(key),
      label: "test",
    });
    const response = await getSummary(
      new Request("http://localhost/api/studies/target/summary", {
        headers: { authorization: `Bearer ${key}` },
      }) as NextRequest,
      { params: Promise.resolve({ id: data.studyRow.id }) },
    );
    expect(response.status).toBe(404);
    await db.delete(tenant).where(eq(tenant.id, data.tenantRow.id));
    await db.delete(tenant).where(eq(tenant.id, other.tenantRow.id));
  });

  it("does not duplicate summary rows for the same inputs hash", async () => {
    const data = await fixture();
    const summary = await generateSummary(data.tenantRow.id, data.studyRow.id, 1);
    const rows = await db
      .select()
      .from(experimentSummary)
      .where(eq(experimentSummary.id, summary.id));
    expect(rows).toHaveLength(1);
    await db.delete(tenant).where(eq(tenant.id, data.tenantRow.id));
  });
});
