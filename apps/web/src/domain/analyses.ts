import { createHash, randomUUID } from "node:crypto";
import type { EvidencePackage } from "@vibecheck/contracts";
import {
  AnalysisOutputSchema,
  EvidencePackageSchema,
  RepoBindingSchema,
  StudyPlanSchema,
} from "@vibecheck/contracts";
import { and, eq, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/db/client";
import { env } from "@/lib/env";
import { newId } from "@/lib/ids";
import { createDevinAnalysisProvider } from "@/providers/analysis/devin";
import { fixtureAnalysisProvider } from "@/providers/analysis/fixture";
import type { AnalysisProvider, ProviderHandle } from "@/providers/analysis/types";
import { emitEvent } from "./events";
import { type EvidenceSource, persistedEvidenceSource } from "./evidence";
import { fixtureEvidenceSource } from "./evidence-source";
import { enqueueJob } from "./jobs";

type AnalysisDeps = { source?: EvidenceSource; provider?: AnalysisProvider };

function normalize(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function fingerprint(productId: string, taskId: string, category: string, semanticTarget: string) {
  return createHash("sha256")
    .update(`${productId}|${taskId}|${category}|${normalize(semanticTarget)}`)
    .digest("hex");
}

function bounded<T>(items: T[], max: number) {
  if (items.length <= max) return { values: items, truncated: false };
  const head = items.slice(0, 50);
  const tail = items.slice(-50);
  const middle = items.slice(50, -50);
  const step = Math.max(1, Math.ceil(middle.length / (max - head.length - tail.length)));
  return {
    values: [...head, ...middle.filter((_, i) => i % step === 0), ...tail].slice(0, max),
    truncated: true,
  };
}

export function validateAnalysisOutput(raw: unknown, evidence: EvidencePackage) {
  const parsed = AnalysisOutputSchema.safeParse(raw);
  if (!parsed.success) return { success: false as const, problems: parsed.error.message };
  if (
    parsed.data.evidence_package_id !== evidence.evidence_package_id ||
    parsed.data.session_id !== evidence.session_id
  )
    return { success: false as const, problems: "evidence_package_id or session_id mismatch" };
  const eventIds = new Set(evidence.events.map((event) => event.event_id));
  const segments = new Map(evidence.transcript.map((segment) => [segment.segment_id, segment]));
  for (const item of parsed.data.findings.flatMap((finding) => finding.evidence)) {
    if (item.segment_ids.some((id) => !segments.has(id)))
      return { success: false as const, problems: "invented segment_id citation" };
    if (item.event_ids.some((id) => !eventIds.has(id)))
      return { success: false as const, problems: "invented event_id citation" };
    if (item.end_ms > evidence.session_duration_ms)
      return { success: false as const, problems: "evidence range exceeds session duration" };
    const times = [
      ...item.segment_ids.map((id) => segments.get(id)?.end_ms ?? 0),
      ...evidence.events
        .filter((event) => item.event_ids.includes(event.event_id))
        .map((event) => event.t_ms),
    ];
    if (!times.some((time) => time >= item.start_ms && time <= item.end_ms))
      return { success: false as const, problems: "evidence range does not overlap citation" };
    if (
      item.quote &&
      !item.segment_ids.some((id) => segments.get(id)?.text.includes(item.quote ?? "") === true)
    )
      return {
        success: false as const,
        problems: "quote is not a verbatim cited segment substring",
      };
  }
  return { success: true as const, data: parsed.data };
}

async function buildEvidencePackage(
  source: EvidenceSource,
  run: typeof schema.analysisRuns.$inferSelect,
  study: typeof schema.studies.$inferSelect,
  planRow: typeof schema.studyRevisions.$inferSelect,
) {
  const manifest = await source.manifest(run.sessionId);
  if (!manifest) throw new Error("manifest_not_found");
  if (manifest.study_revision !== study.currentRevision) throw new Error("revision_mismatch");
  const plan = StudyPlanSchema.parse(planRow.plan);
  if (manifest.tested_commit_sha !== plan.baseline.commit_sha) throw new Error("baseline_mismatch");
  if (manifest.completeness === "incomplete") throw new Error("incomplete_session");
  const [clock, events, transcript] = await Promise.all([
    source.clockMap(run.sessionId),
    source.events(run.sessionId),
    source.transcript(run.sessionId),
  ]);
  if (!clock) throw new Error("clock_map_not_found");
  const boundedEvents = bounded(events, 400);
  const boundedTranscript = bounded(transcript, 200);
  const mediaDuration = manifest.assets.reduce(
    (sum: number, asset) => sum + (asset.duration_ms ?? 0),
    0,
  );
  const sessionDuration = Math.max(
    events.at(-1)?.t_ms ?? 0,
    transcript.at(-1)?.end_ms ?? 0,
    mediaDuration,
    clock.media.reduce((sum: number, media) => sum + (media.duration_ms ?? 0), 0),
  );
  return EvidencePackageSchema.parse({
    schema_version: "1.0",
    evidence_package_id: `evidence_${randomUUID()}`,
    session_id: run.sessionId,
    study_id: study.id,
    study_revision: study.currentRevision,
    baseline_commit_sha: plan.baseline.commit_sha,
    task: plan.task,
    outcome: manifest.outcome,
    completeness: manifest.completeness,
    instrumentation: manifest.instrumentation,
    session_duration_ms: sessionDuration,
    events: boundedEvents.values,
    events_truncated: boundedEvents.truncated,
    transcript: boundedTranscript.values,
    transcript_truncated: boundedTranscript.truncated,
    media: manifest.assets,
    provenance: run.evidenceSource === "fixture" ? "fixture" : "human_session",
  });
}

function providerFor(name: string, override?: AnalysisProvider) {
  if (override) return override;
  if (name === "fixture") return fixtureAnalysisProvider;
  if (name === "devin") {
    const cfg = env().devin;
    if (!cfg) throw new Error("devin_not_configured");
    return createDevinAnalysisProvider(cfg);
  }
  throw new Error("unknown_provider");
}

export async function startAnalysis(
  tenantId: string,
  studyId: string,
  sessionId: string,
  providerName: "fixture" | "devin" = env().ANALYSIS_PROVIDER,
  source: "persisted" | "fixture" = "persisted",
) {
  const study = await db.query.studies.findFirst({
    where: and(eq(schema.studies.id, studyId), eq(schema.studies.tenantId, tenantId)),
  });
  if (!study || study.status === "draft") return null;
  const existing = await db.query.analysisRuns.findFirst({
    where: and(
      eq(schema.analysisRuns.tenantId, tenantId),
      eq(schema.analysisRuns.studyId, studyId),
      eq(schema.analysisRuns.sessionId, sessionId),
    ),
  });
  const run = await db.transaction((tx) =>
    enqueueAnalysisForSession(tx, {
      tenantId,
      studyId,
      sessionId,
      provider: providerName,
      source,
    }),
  );
  if (!run) throw new Error("analysis_run_insert_failed");
  return { status: existing ? (200 as const) : (201 as const), run };
}

export async function enqueueAnalysisForSession(
  tx: Tx,
  input: {
    tenantId: string;
    studyId: string;
    sessionId: string;
    provider: "fixture" | "devin";
    source: "persisted" | "fixture";
  },
) {
  const [created] = await tx
    .insert(schema.analysisRuns)
    .values({
      id: newId("analysis"),
      tenantId: input.tenantId,
      studyId: input.studyId,
      sessionId: input.sessionId,
      status: "queued",
      provider: input.provider,
      evidenceSource: input.source,
      rawResponses: [],
    })
    .onConflictDoNothing()
    .returning();
  const run =
    created ??
    (await tx.query.analysisRuns.findFirst({
      where: and(
        eq(schema.analysisRuns.tenantId, input.tenantId),
        eq(schema.analysisRuns.studyId, input.studyId),
        eq(schema.analysisRuns.sessionId, input.sessionId),
      ),
    }));
  if (created) {
    await enqueueJob(
      {
        type: "analysis.run",
        payload: { analysisRunId: created.id, tenantId: input.tenantId },
        dedupeKey: `analysis.run:${created.id}`,
        maxAttempts: 3,
      },
      tx,
    );
  }
  return run;
}

export async function handleAnalysisRun(runId: string, deps: AnalysisDeps = {}, tenantId?: string) {
  const run = await db.query.analysisRuns.findFirst({
    where: tenantId
      ? and(eq(schema.analysisRuns.id, runId), eq(schema.analysisRuns.tenantId, tenantId))
      : eq(schema.analysisRuns.id, runId),
  });
  if (!run) throw new Error("analysis_run_not_found");
  const study = await db.query.studies.findFirst({
    where: and(eq(schema.studies.id, run.studyId), eq(schema.studies.tenantId, run.tenantId)),
  });
  if (!study) throw new Error("study_not_found");
  const revision = await db.query.studyRevisions.findFirst({
    where: and(
      eq(schema.studyRevisions.studyId, study.id),
      eq(schema.studyRevisions.revision, study.currentRevision),
    ),
  });
  if (!revision) throw new Error("study_plan_not_found");
  const plan = StudyPlanSchema.parse(revision.plan);
  const product = await db.query.products.findFirst({
    where: and(eq(schema.products.id, plan.product_id), eq(schema.products.tenantId, run.tenantId)),
  });
  if (!product) throw new Error("product_not_found");
  let evidence: EvidencePackage;
  try {
    evidence = await buildEvidencePackage(
      deps.source ??
        (run.evidenceSource === "fixture" ? fixtureEvidenceSource : persistedEvidenceSource),
      run,
      study,
      revision,
    );
  } catch (error) {
    await db
      .update(schema.analysisRuns)
      .set({
        status: "failed",
        error: error instanceof Error ? error.message : "analysis_failed",
        updatedAt: new Date(),
      })
      .where(eq(schema.analysisRuns.id, run.id));
    throw error;
  }
  await db
    .update(schema.analysisRuns)
    .set({ status: "analysing", evidencePackage: evidence, updatedAt: new Date() })
    .where(eq(schema.analysisRuns.id, run.id));
  const provider = providerFor(run.provider, deps.provider);
  const rawResponses: unknown[] = [];
  const onSession = async (handle: ProviderHandle) => {
    await db
      .update(schema.analysisRuns)
      .set({
        providerSessionId: handle.sessionId ?? null,
        providerSessionUrl: handle.url ?? null,
        updatedAt: new Date(),
      })
      .where(eq(schema.analysisRuns.id, run.id));
  };
  let result = await provider.analyse(evidence, { id: run.id }, onSession);
  rawResponses.push(result.raw);
  let validated = validateAnalysisOutput(result.raw, evidence);
  if (!validated.success) {
    result = await provider.requestCorrection(result.handle, validated.problems);
    rawResponses.push(result.raw);
    validated = validateAnalysisOutput(result.raw, evidence);
  }
  await db
    .update(schema.analysisRuns)
    .set({ rawResponses, updatedAt: new Date() })
    .where(eq(schema.analysisRuns.id, run.id));
  if (!validated.success) {
    await db
      .update(schema.analysisRuns)
      .set({ status: "failed", error: "unsupported_citations", updatedAt: new Date() })
      .where(eq(schema.analysisRuns.id, run.id));
    return;
  }
  await persistAnalysis(run, study, product, revision, evidence, validated.data);
}

async function persistAnalysis(
  run: typeof schema.analysisRuns.$inferSelect,
  study: typeof schema.studies.$inferSelect,
  product: typeof schema.products.$inferSelect,
  revision: typeof schema.studyRevisions.$inferSelect,
  packageData: EvidencePackage,
  output: ReturnType<typeof AnalysisOutputSchema.parse>,
) {
  await db.transaction(async (tx) => {
    const completed = await tx
      .select({ count: sql<number>`count(*)` })
      .from(schema.analysisRuns)
      .where(
        and(
          eq(schema.analysisRuns.studyId, run.studyId),
          eq(schema.analysisRuns.status, "completed"),
        ),
      );
    const eligible = Number(completed[0]?.count ?? 0) + 1;
    const findingIds: string[] = [];
    const plan = StudyPlanSchema.parse(revision.plan);
    for (const item of output.findings) {
      const fp = fingerprint(product.id, plan.task.task_id, item.category, item.semantic_target);
      const evidence = item.evidence.map((entry) => ({
        session_id: packageData.session_id,
        segment_ids: entry.segment_ids,
        event_ids: entry.event_ids,
        start_ms: entry.start_ms,
        end_ms: entry.end_ms,
      }));
      const existing = await tx.query.findings.findFirst({
        where: and(eq(schema.findings.studyId, run.studyId), eq(schema.findings.fingerprint, fp)),
      });
      if (!existing) {
        const [created] = await tx
          .insert(schema.findings)
          .values({
            id: newId("finding"),
            tenantId: run.tenantId,
            studyId: run.studyId,
            studyRevision: study.currentRevision,
            baselineCommitSha: packageData.baseline_commit_sha,
            title: item.title,
            fingerprint: fp,
            category: item.category,
            semanticTarget: item.semantic_target,
            observation: item.observation,
            hypothesis: item.hypothesis,
            impact: item.impact,
            certainty: "preliminary",
            limitations: item.limitations,
            suggestedExperiment: item.suggested_experiment ?? null,
            evidence,
            observedSessionCount: 1,
            eligibleSessionCount: eligible,
            provenance: packageData.provenance,
          })
          .returning();
        if (created) findingIds.push(created.id);
      } else {
        const hasSession = existing.evidence.some(
          (entry) => entry.session_id === packageData.session_id,
        );
        const [updated] = await tx
          .update(schema.findings)
          .set({
            evidence: hasSession ? existing.evidence : [...existing.evidence, ...evidence],
            observedSessionCount: hasSession
              ? existing.observedSessionCount
              : existing.observedSessionCount + 1,
            eligibleSessionCount: eligible,
            certainty:
              !hasSession && existing.observedSessionCount + 1 >= 2
                ? "repeated_observation"
                : existing.certainty,
            updatedAt: new Date(),
          })
          .where(eq(schema.findings.id, existing.id))
          .returning();
        if (updated) findingIds.push(updated.id);
      }
    }
    await tx
      .update(schema.findings)
      .set({ eligibleSessionCount: eligible, updatedAt: new Date() })
      .where(eq(schema.findings.studyId, run.studyId));
    const binding = RepoBindingSchema.safeParse(product.repoBinding);
    await tx
      .update(schema.analysisRuns)
      .set({
        status: "completed",
        outcome: output.outcome,
        error: binding.success ? null : "publication: github_disconnected",
        updatedAt: new Date(),
      })
      .where(eq(schema.analysisRuns.id, run.id));
    await emitEvent(tx, {
      type: "analysis.completed",
      tenantId: run.tenantId,
      productId: product.id,
      correlationId: run.id,
      idempotencyKey: `${run.id}:analysis_completed`,
      payload: { finding_ids: findingIds },
    });
    if (binding.success && (binding.data.provider === "local" || binding.data.issues_enabled)) {
      for (const findingId of findingIds)
        await enqueueJob(
          {
            type: "issue.publish",
            payload: { findingId, tenantId: run.tenantId },
            dedupeKey: `issue.publish:${findingId}:${run.id}`,
          },
          tx,
        );
    }
  });
}
