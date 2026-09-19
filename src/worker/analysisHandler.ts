import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  analysisRun,
  discoveryRun,
  finding,
  job,
  outboxEvent,
  product,
  study,
  studyPlanRevision,
} from "@/db/schema";
import { analysisOutputSchema, type AnalysisOutput } from "@/contracts/analysisOutput";
import { evidencePackageSchema, type EvidencePackage } from "@/contracts/evidencePackage";
import { repoBindingSchema } from "@/contracts/repoBinding";
import { evidenceSource } from "@/evidence/fixture";
import type { EvidenceSource } from "@/evidence/types";
import { fixtureAnalysisProvider } from "@/agents/analysis/fixture";
import { devinAnalysisProvider } from "@/agents/analysis/devin";
import type { AnalysisProvider } from "@/agents/analysis/types";
import type { ProviderHandle } from "@/agents/types";

type AnalysisDeps = { source?: EvidenceSource; provider?: AnalysisProvider };

function providerFor(name: string, override?: AnalysisProvider): AnalysisProvider {
  if (override) return override;
  if (name === "fixture") return fixtureAnalysisProvider;
  if (name === "devin") return devinAnalysisProvider;
  throw new Error("unknown_provider");
}

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

function selectBounded<T>(items: T[], max: number): { values: T[]; truncated: boolean } {
  if (items.length <= max) return { values: items, truncated: false };
  const head = items.slice(0, 50);
  const tail = items.slice(-50);
  const middle = items.slice(50, -50);
  const step = Math.max(1, Math.ceil(middle.length / (max - head.length - tail.length)));
  return {
    values: [...head, ...middle.filter((_, index) => index % step === 0), ...tail].slice(0, max),
    truncated: true,
  };
}

function validateOutput(raw: unknown, evidence: EvidencePackage) {
  const parsed = analysisOutputSchema.safeParse(raw);
  if (!parsed.success) return { success: false as const, problems: parsed.error.message };
  if (
    parsed.data.evidence_package_id !== evidence.evidence_package_id ||
    parsed.data.session_id !== evidence.session_id
  ) {
    return { success: false as const, problems: "evidence_package_id or session_id mismatch" };
  }
  const eventIds = new Set(evidence.events.map((event) => event.event_id));
  const segments = new Map(evidence.transcript.map((segment) => [segment.segment_id, segment]));
  for (const item of parsed.data.findings.flatMap((finding) => finding.evidence)) {
    if (item.segment_ids.some((id) => !segments.has(id))) {
      return { success: false as const, problems: "invented segment_id citation" };
    }
    if (item.event_ids.some((id) => !eventIds.has(id))) {
      return { success: false as const, problems: "invented event_id citation" };
    }
    if (item.end_ms > evidence.session_duration_ms) {
      return { success: false as const, problems: "evidence range exceeds session duration" };
    }
    const overlaps = [
      ...item.segment_ids.map((id) => segments.get(id)?.end_ms ?? 0),
      ...evidence.events
        .filter((event) => item.event_ids.includes(event.event_id))
        .map((event) => event.t_ms),
    ].some((time) => time >= item.start_ms && time <= item.end_ms);
    if (!overlaps)
      return { success: false as const, problems: "evidence range does not overlap citation" };
    if (
      item.quote &&
      !item.segment_ids.some((id) => segments.get(id)?.text.includes(item.quote ?? "") === true)
    ) {
      return {
        success: false as const,
        problems: "quote is not a verbatim cited segment substring",
      };
    }
  }
  return { success: true as const, data: parsed.data };
}

async function buildEvidencePackage(
  source: EvidenceSource,
  run: typeof analysisRun.$inferSelect,
  studyRow: typeof study.$inferSelect,
  plan: typeof studyPlanRevision.$inferSelect,
) {
  const manifest = await source.manifest(run.sessionId);
  if (!manifest) throw new Error("manifest_not_found");
  if (manifest.study_revision !== studyRow.currentRevision) throw new Error("revision_mismatch");
  if (manifest.tested_commit_sha !== plan.plan.baseline.commit_sha)
    throw new Error("baseline_mismatch");
  if (manifest.completeness === "incomplete") throw new Error("incomplete_session");
  const [clock, events, transcript] = await Promise.all([
    source.clockMap(run.sessionId),
    source.events(run.sessionId),
    source.transcript(run.sessionId),
  ]);
  if (!clock) throw new Error("clock_map_not_found");
  const boundedEvents = selectBounded(events, 400);
  const boundedTranscript = selectBounded(transcript, 200);
  const mediaDuration = manifest.assets.reduce((sum, asset) => sum + (asset.duration_ms ?? 0), 0);
  const sessionDuration = Math.max(
    events.at(-1)?.t_ms ?? 0,
    transcript.at(-1)?.end_ms ?? 0,
    mediaDuration,
    clock.media.reduce((sum, media) => sum + (media.duration_ms ?? 0), 0),
  );
  return evidencePackageSchema.parse({
    schema_version: "1.0",
    evidence_package_id: `evidence_${randomUUID()}`,
    session_id: run.sessionId,
    study_id: studyRow.id,
    study_revision: studyRow.currentRevision,
    baseline_commit_sha: plan.plan.baseline.commit_sha,
    task: plan.plan.task,
    outcome: manifest.outcome,
    completeness: manifest.completeness,
    instrumentation: manifest.instrumentation,
    session_duration_ms: sessionDuration,
    events: boundedEvents.values,
    events_truncated: boundedEvents.truncated,
    transcript: boundedTranscript.values,
    transcript_truncated: boundedTranscript.truncated,
    media: manifest.assets,
    provenance: "fixture",
  });
}

export async function handleAnalysisRun(runId: string, deps: AnalysisDeps = {}, tenantId?: string) {
  const [run] = await db
    .select()
    .from(analysisRun)
    .where(
      tenantId
        ? and(eq(analysisRun.id, runId), eq(analysisRun.tenantId, tenantId))
        : eq(analysisRun.id, runId),
    )
    .limit(1);
  if (!run) throw new Error("analysis_run_not_found");
  const [studyRow] = await db
    .select()
    .from(study)
    .where(and(eq(study.id, run.studyId), eq(study.tenantId, run.tenantId)))
    .limit(1);
  if (!studyRow) throw new Error("study_not_found");
  const [plan] = await db
    .select()
    .from(studyPlanRevision)
    .where(
      and(
        eq(studyPlanRevision.studyId, studyRow.id),
        eq(studyPlanRevision.revision, studyRow.currentRevision),
      ),
    )
    .limit(1);
  if (!plan) throw new Error("study_plan_not_found");
  const [productRow] = await db
    .select()
    .from(product)
    .where(and(eq(product.id, plan.plan.product_id), eq(product.tenantId, run.tenantId)))
    .limit(1);
  if (!productRow) throw new Error("product_not_found");
  const packageData = await buildEvidencePackage(
    deps.source ?? evidenceSource(),
    run,
    studyRow,
    plan,
  );
  await db
    .update(analysisRun)
    .set({ status: "analysing", evidencePackage: packageData })
    .where(eq(analysisRun.id, run.id));
  const provider = providerFor(run.provider, deps.provider);
  const rawResponses: unknown[] = [];
  const onSession = async (handle: ProviderHandle) => {
    const session = {
      ...(handle.sessionId ? { providerSessionId: handle.sessionId } : {}),
      ...(handle.url ? { providerSessionUrl: handle.url } : {}),
    };
    if (Object.keys(session).length === 0) return;
    await db.update(analysisRun).set(session).where(eq(analysisRun.id, run.id));
  };
  let result = await provider.analyse(packageData, { id: run.id }, onSession);
  rawResponses.push(result.raw);
  let validated = validateOutput(result.raw, packageData);
  if (!validated.success) {
    result = await provider.requestCorrection(result.handle, validated.problems);
    rawResponses.push(result.raw);
    validated = validateOutput(result.raw, packageData);
    await db.update(analysisRun).set({ rawResponses }).where(eq(analysisRun.id, run.id));
  } else {
    await db.update(analysisRun).set({ rawResponses }).where(eq(analysisRun.id, run.id));
  }
  if (!validated.success) {
    await db
      .update(analysisRun)
      .set({ status: "failed", error: "unsupported_citations" })
      .where(eq(analysisRun.id, run.id));
    return;
  }
  await persistAnalysis(run, studyRow, productRow, plan, packageData, validated.data);
}

async function persistAnalysis(
  run: typeof analysisRun.$inferSelect,
  studyRow: typeof study.$inferSelect,
  productRow: typeof product.$inferSelect,
  plan: typeof studyPlanRevision.$inferSelect,
  packageData: EvidencePackage,
  output: AnalysisOutput,
) {
  await db.transaction(async (tx) => {
    const [completed] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(analysisRun)
      .where(and(eq(analysisRun.studyId, run.studyId), eq(analysisRun.status, "completed")));
    const eligible = Number(completed?.count ?? 0) + 1;
    const findingIds: string[] = [];
    for (const item of output.findings) {
      const itemFingerprint = fingerprint(
        productRow.id,
        plan.plan.task.task_id,
        item.category,
        item.semantic_target,
      );
      const evidence = item.evidence.map((entry) => ({
        session_id: packageData.session_id,
        segment_ids: entry.segment_ids,
        event_ids: entry.event_ids,
        start_ms: entry.start_ms,
        end_ms: entry.end_ms,
      }));
      const [existing] = await tx
        .select()
        .from(finding)
        .where(and(eq(finding.studyId, run.studyId), eq(finding.fingerprint, itemFingerprint)))
        .limit(1);
      if (!existing) {
        const [created] = await tx
          .insert(finding)
          .values({
            tenantId: run.tenantId,
            studyId: run.studyId,
            studyRevision: studyRow.currentRevision,
            baselineCommitSha: packageData.baseline_commit_sha,
            fingerprint: itemFingerprint,
            category: item.category,
            semanticTarget: item.semantic_target,
            observation: item.observation,
            hypothesis: item.hypothesis,
            impact: item.impact,
            certainty: "preliminary",
            limitations: item.limitations,
            suggestedExperiment: item.suggested_experiment,
            evidence,
            observedSessionCount: 1,
            eligibleSessionCount: eligible,
            provenance: packageData.provenance,
          })
          .returning();
        findingIds.push(created.id);
      } else {
        const hasSession = existing.evidence.some(
          (entry) => entry.session_id === packageData.session_id,
        );
        const mergedEvidence = hasSession ? existing.evidence : [...existing.evidence, ...evidence];
        const observed = hasSession
          ? existing.observedSessionCount
          : existing.observedSessionCount + 1;
        const [updated] = await tx
          .update(finding)
          .set({
            evidence: mergedEvidence,
            observedSessionCount: observed,
            eligibleSessionCount: eligible,
            certainty: observed >= 2 ? "repeated_observation" : existing.certainty,
          })
          .where(eq(finding.id, existing.id))
          .returning();
        findingIds.push(updated.id);
      }
    }
    await tx
      .update(finding)
      .set({ eligibleSessionCount: eligible })
      .where(eq(finding.studyId, run.studyId));
    const binding = repoBindingSchema.safeParse(productRow.repoBinding);
    const reason = binding.success ? undefined : "publication: github_disconnected";
    await tx
      .update(analysisRun)
      .set({
        status: "completed",
        outcome: output.outcome,
        error: reason,
      })
      .where(eq(analysisRun.id, run.id));
    await tx
      .insert(outboxEvent)
      .values({
        eventId: randomUUID(),
        eventType: "analysis.completed",
        idempotencyKey: `${run.id}:analysis_completed`,
        tenantId: run.tenantId,
        productId: productRow.id,
        correlationId: run.id,
        payload: { finding_ids: findingIds },
        occurredAt: new Date(),
      })
      .onConflictDoNothing({ target: outboxEvent.idempotencyKey });
    if (binding.success && binding.data.issues_enabled) {
      for (const findingId of findingIds) {
        await tx.insert(job).values({
          type: "issue.publish",
          tenantId: run.tenantId,
          payload: { findingId },
        });
      }
    }
  });
}
