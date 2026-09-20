import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { analysisRun, finding, product, study, studyPlanRevision, tenant } from "@/db/schema";
import { evidencePackageSchema, type EvidencePackage } from "@/contracts/evidencePackage";
import type { AnalysisOutput } from "@/contracts/analysisOutput";
import { sessionManifestSchema, type SessionManifest } from "@/contracts/session";
import { fixtureEvidenceSource } from "@/evidence/fixture";
import { startAnalysis } from "@/services/analyses";
import { handleAnalysisRun, validateAnalysisOutput } from "./analysisHandler";
import type { AnalysisProvider } from "@/agents/analysis/types";
import type { EvidenceSource } from "@/evidence/types";

const BASELINE = "97c68dd371e13c017a8dcca49f8b3995ba7890a8";

function planFor(studyId: string, productId: string, revision = 1) {
  return {
    schema_version: "1.0" as const,
    study_id: studyId,
    study_revision: revision,
    product_id: productId,
    task: {
      task_id: "task_capture_ideas",
      participant_prompt: "Add an idea.",
      research_question: "Can users add ideas?",
      time_limit_seconds: 300,
      success_rule_ref: "stickynote_capture_v1",
      fixture_ref: "fixture",
    },
    baseline: { commit_sha: BASELINE, environment_ref: "fixture" },
    recruitment: {
      source: "marketplace" as const,
      target_count: 1,
      cohort: "fixture",
      eligibility_rule_ref: "eligible_whiteboard_users_v1",
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

async function fixture(options: { sessionId?: string; revision?: number } = {}) {
  const [tenantRow] = await db
    .insert(tenant)
    .values({ name: `analysis-${randomUUID()}` })
    .returning();
  const [productRow] = await db
    .insert(product)
    .values({
      tenantId: tenantRow.id,
      name: "fixture product",
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
  const revision = options.revision ?? 1;
  const [studyRow] = await db
    .insert(study)
    .values({
      tenantId: tenantRow.id,
      productId: productRow.id,
      status: "published",
      currentRevision: revision,
    })
    .returning();
  const plan = planFor(studyRow.id, productRow.id, revision);
  await db.insert(studyPlanRevision).values({
    studyId: studyRow.id,
    revision,
    plan,
    publishedAt: new Date(),
  });
  const [run] = await db
    .insert(analysisRun)
    .values({
      tenantId: tenantRow.id,
      studyId: studyRow.id,
      sessionId: options.sessionId ?? "sample_session_capture_ideas",
      status: "queued",
      provider: "fixture",
      rawResponses: [],
    })
    .returning();
  return { tenantRow, productRow, studyRow, plan, run };
}

function outputFor(evidence: EvidencePackage): AnalysisOutput {
  return {
    schema_version: "1.0",
    evidence_package_id: evidence.evidence_package_id,
    session_id: evidence.session_id,
    outcome: "findings",
    findings: [
      {
        title: "Toolbar: sticky note tool is hard to discover",
        category: "discoverability",
        semantic_target: "toolbar.sticky_note",
        observation: "The participant searched for a note tool.",
        hypothesis: "The note tool may be difficult to discover.",
        evidence: [
          {
            segment_ids: ["segment_01"],
            event_ids: ["event_03"],
            start_ms: 7000,
            end_ms: 12000,
            quote:
              "I need to add a few ideas to this board, but I do not immediately see how to add a note.",
          },
        ],
        impact: "task_slowed",
        limitations: ["fixture"],
      },
    ],
  };
}

async function evidenceFor(sessionId: string): Promise<EvidencePackage> {
  const manifest = await fixtureEvidenceSource.manifest("sample_session_capture_ideas");
  const clock = await fixtureEvidenceSource.clockMap("sample_session_capture_ideas");
  const events = await fixtureEvidenceSource.events("sample_session_capture_ideas");
  const transcript = await fixtureEvidenceSource.transcript("sample_session_capture_ideas");
  if (!manifest || !clock) throw new Error("fixture evidence unavailable");
  return evidencePackageSchema.parse({
    schema_version: "1.0",
    evidence_package_id: "evidence_test",
    session_id: sessionId,
    study_id: "study_test",
    study_revision: 1,
    baseline_commit_sha: BASELINE,
    task: planFor("study_test", "product_test").task,
    outcome: manifest.outcome,
    completeness: manifest.completeness,
    instrumentation: manifest.instrumentation,
    session_duration_ms: 102000,
    events,
    events_truncated: false,
    transcript,
    transcript_truncated: false,
    media: manifest.assets,
    provenance: "fixture",
  });
}

function fixedFixtureSource(
  manifestOverride?: (manifest: SessionManifest) => SessionManifest,
): EvidenceSource {
  return {
    async manifest() {
      const manifest = await fixtureEvidenceSource.manifest("sample_session_capture_ideas");
      if (!manifest) return null;
      return manifestOverride ? manifestOverride(manifest) : manifest;
    },
    clockMap: () => fixtureEvidenceSource.clockMap("sample_session_capture_ideas"),
    events: () => fixtureEvidenceSource.events("sample_session_capture_ideas"),
    transcript: () => fixtureEvidenceSource.transcript("sample_session_capture_ideas"),
  };
}

describe.skipIf(!process.env.DATABASE_URL)("analysis worker handler", () => {
  it("accepts a correction for an invented segment and keeps both responses", async () => {
    const data = await fixture();
    let evidenceForCorrection: EvidencePackage | undefined;
    const provider: AnalysisProvider = {
      name: "fixture",
      async analyse(evidence) {
        evidenceForCorrection = evidence;
        const invalid = outputFor(evidence);
        invalid.findings[0].evidence[0].segment_ids = ["invented_segment"];
        return { raw: invalid, handle: {} };
      },
      async requestCorrection() {
        if (!evidenceForCorrection) throw new Error("missing evidence");
        return { raw: outputFor(evidenceForCorrection), handle: {} };
      },
    };
    await handleAnalysisRun(data.run.id, { provider });
    const [run] = await db.select().from(analysisRun).where(eq(analysisRun.id, data.run.id));
    const [storedFinding] = await db
      .select()
      .from(finding)
      .where(eq(finding.studyId, data.studyRow.id));
    expect({
      status: run?.status,
      responses: run?.rawResponses.length,
      title: storedFinding?.title,
    }).toEqual({
      status: "completed",
      responses: 2,
      title: "Toolbar: sticky note tool is hard to discover",
    });
    await db.delete(tenant).where(eq(tenant.id, data.tenantRow.id));
  });

  it("fails exhausted malformed output without partial findings", async () => {
    const data = await fixture();
    let evidenceForCorrection: EvidencePackage | undefined;
    const provider: AnalysisProvider = {
      name: "fixture",
      async analyse(evidence) {
        evidenceForCorrection = evidence;
        const invalid = outputFor(evidence);
        invalid.findings[0].evidence[0].segment_ids = ["invented_segment"];
        return { raw: invalid, handle: {} };
      },
      async requestCorrection() {
        if (!evidenceForCorrection) throw new Error("missing evidence");
        const invalid = outputFor(evidenceForCorrection);
        invalid.findings[0].evidence[0].segment_ids = ["still_invented"];
        return { raw: invalid, handle: {} };
      },
    };
    await handleAnalysisRun(data.run.id, { provider });
    const [run] = await db.select().from(analysisRun).where(eq(analysisRun.id, data.run.id));
    const rows = await db.select().from(finding).where(eq(finding.studyId, data.studyRow.id));
    expect({
      status: run?.status,
      error: run?.error,
      responses: run?.rawResponses.length,
      findings: rows.length,
    }).toEqual({
      status: "failed",
      error: "unsupported_citations",
      responses: 2,
      findings: 0,
    });
    await db.delete(tenant).where(eq(tenant.id, data.tenantRow.id));
  });

  it("aggregates the same fingerprint from a second session", async () => {
    const data = await fixture();
    const provider: AnalysisProvider = {
      name: "fixture",
      async analyse(evidence) {
        return { raw: outputFor(evidence), handle: {} };
      },
      async requestCorrection() {
        return { raw: null, handle: {} };
      },
    };
    await handleAnalysisRun(data.run.id, { provider });
    const [secondRun] = await db
      .insert(analysisRun)
      .values({
        tenantId: data.tenantRow.id,
        studyId: data.studyRow.id,
        sessionId: "sample_session_capture_ideas_second",
        status: "queued",
        provider: "fixture",
        rawResponses: [],
      })
      .returning();
    await handleAnalysisRun(secondRun.id, {
      provider,
      source: fixedFixtureSource(),
    });
    const [row] = await db.select().from(finding).where(eq(finding.studyId, data.studyRow.id));
    expect({ observed: row?.observedSessionCount, certainty: row?.certainty }).toEqual({
      observed: 2,
      certainty: "repeated_observation",
    });
    await db.delete(tenant).where(eq(tenant.id, data.tenantRow.id));
  });

  it("fails revision mismatch before provider analysis", async () => {
    const data = await fixture({ revision: 1 });
    const source = fixedFixtureSource((manifest) =>
      sessionManifestSchema.parse({ ...manifest, study_revision: 2 }),
    );
    await expect(handleAnalysisRun(data.run.id, { source })).rejects.toThrow("revision_mismatch");
    const [run] = await db.select().from(analysisRun).where(eq(analysisRun.id, data.run.id));
    expect({ status: run?.status, error: run?.error }).toEqual({
      status: "failed",
      error: "revision_mismatch",
    });
    await db.delete(tenant).where(eq(tenant.id, data.tenantRow.id));
  });

  it("rejects quotes that are not transcript substrings", async () => {
    const evidence = await evidenceFor("sample_session_capture_ideas");
    const invalid = outputFor(evidence);
    invalid.findings[0].evidence[0].quote = "not in the transcript";
    expect(validateAnalysisOutput(invalid, evidence)).toEqual({
      success: false,
      problems: "quote is not a verbatim cited segment substring",
    });
  });

  it("replaying a session returns the existing run", async () => {
    const data = await fixture();
    await db.delete(analysisRun).where(eq(analysisRun.id, data.run.id));
    const first = await startAnalysis(data.tenantRow.id, data.studyRow.id, data.run.sessionId);
    const second = await startAnalysis(data.tenantRow.id, data.studyRow.id, data.run.sessionId);
    expect({
      first: first?.status,
      second: second?.status,
      sameRun: first?.run.id === second?.run.id,
    }).toEqual({ first: 201, second: 200, sameRun: true });
    await db.delete(tenant).where(eq(tenant.id, data.tenantRow.id));
  });
});
