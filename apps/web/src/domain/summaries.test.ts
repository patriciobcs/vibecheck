import { EvidencePackageSchema, ParticipationEventSchema } from "@vibecheck/contracts";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/db/client";
import type { SummaryProvider } from "@/providers/summary/types";
import { resetDb } from "@/test/db";
import { seedStudy } from "@/test/fixtures";
import { runJob } from "@/worker/runner";
import { recordParticipation } from "./participation";
import { computeDeterministic, generateSummary, latestSummary } from "./summaries";

const event = (kind: "invited" | "completed", id: string, sessionId: string | null = null) => ({
  schema_version: "1.0" as const,
  event_id: id,
  study_id: "replace",
  study_revision: 1,
  participant_ref: `participant-${id}`,
  kind,
  occurred_at: new Date().toISOString(),
  session_id: sessionId,
});

function evidence(studyId: string, revision: number, sessionId: string) {
  return EvidencePackageSchema.parse({
    schema_version: "1.0",
    evidence_package_id: `package-${sessionId}`,
    session_id: sessionId,
    study_id: studyId,
    study_revision: revision,
    baseline_commit_sha: "a".repeat(40),
    task: {
      task_id: "task_1",
      participant_prompt: "Complete the task",
      research_question: "Can the task be completed?",
      success_rule_ref: "success_v1",
      time_limit_seconds: 60,
    },
    outcome: { participant_reported: "completed", instrumented: "unknown" },
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

describe("VC-05 experiment summaries", () => {
  beforeEach(() => resetDb());

  it("records participation idempotently and emits one event", async () => {
    const { tenantId, studyId } = await seedStudy();
    const input = { ...event("invited", "evt-1"), study_id: studyId };
    const first = await recordParticipation(tenantId, studyId, input);
    const second = await recordParticipation(tenantId, studyId, input);
    const rows = await db.query.participationEvents.findMany();
    const outbox = await db.query.eventOutbox.findMany({
      where: eq(schema.eventOutbox.eventType, "participation.recorded"),
    });
    expect({ first, second, rows: rows.length, outbox: outbox.length }).toEqual({
      first: { created: true, id: first.id },
      second: { created: false, id: first.id },
      rows: 1,
      outbox: 1,
    });
  });

  it("rejects a session participation event without a session id", () => {
    expect(ParticipationEventSchema.safeParse(event("completed", "evt-2")).success).toBe(false);
  });

  it("rejects participation from a stale study revision", async () => {
    const { tenantId, studyId } = await seedStudy();
    await expect(
      recordParticipation(tenantId, studyId, {
        ...event("invited", "evt-stale"),
        study_id: studyId,
        study_revision: 2,
      }),
    ).rejects.toMatchObject({ status: 422, code: "study_revision_mismatch" });
  });

  it("computes outcomes and skips queued analysis runs", async () => {
    const { tenantId, studyId, plan } = await seedStudy();
    await db.insert(schema.analysisRuns).values([
      {
        id: "run-complete",
        tenantId,
        studyId,
        sessionId: "session-complete",
        status: "completed",
        provider: "fixture",
        evidenceSource: "fixture",
        evidencePackage: evidence(studyId, 1, "session-complete"),
      },
      {
        id: "run-baseline",
        tenantId,
        studyId,
        sessionId: "session-baseline",
        status: "failed",
        provider: "fixture",
        evidenceSource: "fixture",
        error: "baseline_mismatch",
      },
      {
        id: "run-queued",
        tenantId,
        studyId,
        sessionId: "session-queued",
        status: "queued",
        provider: "fixture",
        evidenceSource: "fixture",
      },
    ]);
    const result = await computeDeterministic(tenantId, studyId, 1);
    expect({
      baseline: result.summary.baseline_commit_sha,
      eligible: result.summary.sessions.eligible,
      completed: result.summary.sessions.outcomes.completed,
      excluded: result.summary.sessions.excluded.map((row) => row.reason),
      provenance: result.summary.provenance,
      plan: plan.baseline.commit_sha,
    }).toEqual({
      baseline: plan.baseline.commit_sha,
      eligible: 1,
      completed: 1,
      excluded: ["baseline_mismatch"],
      provenance: "fixture",
      plan: plan.baseline.commit_sha,
    });
  });

  it("generates fixture narrative and reuses unchanged input", async () => {
    const { tenantId, studyId } = await seedStudy();
    await db.insert(schema.analysisRuns).values({
      id: "run-narrative",
      tenantId,
      studyId,
      sessionId: "session-narrative",
      status: "completed",
      provider: "fixture",
      evidenceSource: "fixture",
      evidencePackage: evidence(studyId, 1, "session-narrative"),
    });
    await db.insert(schema.findings).values({
      id: "finding-summary",
      tenantId,
      studyId,
      studyRevision: 1,
      baselineCommitSha: "a".repeat(40),
      title: "Toolbar: sticky note tool is hard to discover",
      fingerprint: "fingerprint",
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
    const first = await generateSummary(tenantId, studyId, 1);
    const second = await generateSummary(tenantId, studyId, 1);
    await recordParticipation(tenantId, studyId, {
      ...event("invited", "evt-new"),
      study_id: studyId,
    });
    const changed = await generateSummary(tenantId, studyId, 1);
    expect({
      same: first.id === second.id,
      changedRevision: changed.revision,
      status: first.status,
      headline: first.summary.narrative.headline,
      provenance: first.summary.provenance,
      revisions: (await latestSummary(tenantId, studyId)).revisions.length,
    }).toEqual({
      same: true,
      changedRevision: 2,
      status: "summarized",
      headline: "Toolbar: sticky note tool is hard to discover was observed across sessions",
      provenance: "fixture",
      revisions: 2,
    });
  });

  it("requests one correction and stores failed status for invalid narrative", async () => {
    const { tenantId, studyId } = await seedStudy();
    await db.insert(schema.analysisRuns).values({
      id: "run-invalid",
      tenantId,
      studyId,
      sessionId: "session-invalid",
      status: "completed",
      provider: "fixture",
      evidenceSource: "fixture",
      evidencePackage: evidence(studyId, 1, "session-invalid"),
    });
    await db.insert(schema.findings).values({
      id: "finding-invalid",
      tenantId,
      studyId,
      studyRevision: 1,
      baselineCommitSha: "a".repeat(40),
      title: "Toolbar: sticky note tool is hard to discover",
      fingerprint: "fingerprint-invalid",
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
    let corrections = 0;
    const invalidProvider: SummaryProvider = {
      name: "invalid",
      async summarize() {
        return { raw: {}, handle: {} };
      },
      async requestCorrection(handle) {
        corrections += 1;
        return { raw: {}, handle };
      },
    };
    const result = await generateSummary(tenantId, studyId, 1, {
      provider: invalidProvider,
    });
    expect({ status: result.status, error: result.error, corrections }).toEqual({
      status: "failed",
      error: "invalid_narrative",
      corrections: 1,
    });
  });

  it("queues one summary job for repeated completed participation", async () => {
    const { tenantId, studyId } = await seedStudy();
    const input = { ...event("completed", "evt-completed", "session-1"), study_id: studyId };
    await recordParticipation(tenantId, studyId, input);
    await recordParticipation(tenantId, studyId, input);
    const jobs = await db.query.jobs.findMany({
      where: (row, { eq }) => eq(row.type, "summary.generate"),
    });
    expect(jobs).toHaveLength(1);
  });

  it("runs a queued summary job", async () => {
    const { tenantId, studyId } = await seedStudy();
    await runJob("summary.generate", { tenantId, studyId, studyRevision: 1 });
    const row = await db.query.experimentSummaries.findFirst();
    expect(row?.status).toBe("collecting");
  });
});
