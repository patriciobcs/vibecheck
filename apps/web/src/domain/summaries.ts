import { createHash } from "node:crypto";
import {
  type ExperimentSummary,
  ExperimentSummarySchema,
  StudyPlanSchema,
  SummaryNarrativeOutputSchema,
} from "@vibecheck/contracts";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { type Db, db, schema, type Tx } from "@/db/client";
import { env } from "@/lib/env";
import { newId } from "@/lib/ids";
import { createDevinSummaryProvider } from "@/providers/summary/devin";
import { fixtureSummaryProvider } from "@/providers/summary/fixture";
import type { SummaryProvider, SummaryProviderInput } from "@/providers/summary/types";
import { emitEvent } from "./events";
import { enqueueJob } from "./jobs";

const provenanceRank = { human_session: 0, simulated_session: 1, fixture: 2 } as const;
const participationKinds = [
  "invited",
  "accepted",
  "dismissed",
  "started",
  "completed",
  "abandoned",
] as const;
const outcomeKinds = ["completed", "stuck", "gave_up", "withdrew", "unknown"] as const;

function strictestProvenance(values: string[]) {
  return (values.sort(
    (left, right) =>
      provenanceRank[right as keyof typeof provenanceRank] -
      provenanceRank[left as keyof typeof provenanceRank],
  )[0] ?? "human_session") as ExperimentSummary["provenance"];
}

function emptyNarrative(): ExperimentSummary["narrative"] {
  return { headline: "", observations: [], limitations: [] };
}

function providerFor(name: string, override?: SummaryProvider) {
  if (override) return override;
  if (name === "fixture") return fixtureSummaryProvider;
  if (name === "devin") {
    const cfg = env().devin;
    if (!cfg) throw new Error("devin_not_configured");
    return createDevinSummaryProvider(cfg);
  }
  throw new Error("unknown_provider");
}

function inputHash(rows: Array<[string, string, string]>) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        rows.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
      ),
    )
    .digest("hex");
}

export async function computeDeterministic(
  tenantId: string,
  studyId: string,
  studyRevision: number,
) {
  const study = await db.query.studies.findFirst({
    where: and(eq(schema.studies.id, studyId), eq(schema.studies.tenantId, tenantId)),
  });
  if (!study) throw new Error("study_not_found");
  const revision = await db.query.studyRevisions.findFirst({
    where: and(
      eq(schema.studyRevisions.studyId, studyId),
      eq(schema.studyRevisions.revision, studyRevision),
    ),
  });
  if (!revision) throw new Error("study_plan_not_found");
  const plan = StudyPlanSchema.parse(revision.plan);
  const [runs, participation, findings] = await Promise.all([
    db.query.analysisRuns.findMany({
      where: and(
        eq(schema.analysisRuns.studyId, studyId),
        eq(schema.analysisRuns.tenantId, tenantId),
      ),
    }),
    db.query.participationEvents.findMany({
      where: and(
        eq(schema.participationEvents.studyId, studyId),
        eq(schema.participationEvents.tenantId, tenantId),
        eq(schema.participationEvents.studyRevision, studyRevision),
      ),
    }),
    db.query.findings.findMany({
      where: and(
        eq(schema.findings.studyId, studyId),
        eq(schema.findings.tenantId, tenantId),
        eq(schema.findings.studyRevision, studyRevision),
      ),
    }),
  ]);
  const funnel = Object.fromEntries(
    participationKinds.map((kind) => [
      kind,
      participation.filter((row) => row.kind === kind).length,
    ]),
  ) as Record<(typeof participationKinds)[number], number>;
  const excluded: ExperimentSummary["sessions"]["excluded"] = [];
  const outcomes = Object.fromEntries(outcomeKinds.map((kind) => [kind, 0])) as Record<
    (typeof outcomeKinds)[number],
    number
  >;
  const eligibleRuns = [];
  for (const run of runs) {
    if (run.status === "queued" || run.status === "analysing") continue;
    if (run.error === "baseline_mismatch") {
      excluded.push({ session_id: run.sessionId, reason: "baseline_mismatch" });
      continue;
    }
    if (run.error === "incomplete_session" || run.error === "incomplete_capture") {
      excluded.push({ session_id: run.sessionId, reason: "incomplete_capture" });
      continue;
    }
    if (run.status !== "completed" || !run.evidencePackage) {
      excluded.push({ session_id: run.sessionId, reason: "analysis_failed" });
      continue;
    }
    if (run.evidencePackage.completeness !== "complete") {
      excluded.push({ session_id: run.sessionId, reason: "incomplete_capture" });
      continue;
    }
    eligibleRuns.push(run);
    outcomes[run.evidencePackage.outcome.participant_reported] += 1;
  }
  const themes = findings
    .slice()
    .sort(
      (left, right) =>
        right.observedSessionCount - left.observedSessionCount ||
        left.title.localeCompare(right.title),
    )
    .map((row) => ({
      finding_id: row.id,
      title: row.title,
      category: row.category,
      observation: row.observation,
      hypothesis: row.hypothesis,
      observed_session_count: row.observedSessionCount,
      eligible_session_count: row.eligibleSessionCount,
      certainty: row.certainty,
      impact: row.impact,
      issue_ref:
        row.issueRepo && row.issueNumber && row.issueUrl
          ? {
              provider: "github" as const,
              repo: row.issueRepo,
              number: row.issueNumber,
              url: row.issueUrl,
            }
          : null,
      // TODO(VC-04 port): read repair run status per finding once repair tables exist on main (PR #5).
      repair_status: null,
    }));
  const provenance = strictestProvenance([
    ...findings.map((row) => row.provenance),
    ...eligibleRuns.map((run) => run.evidencePackage?.provenance ?? "human_session"),
  ]);
  const rows: Array<[string, string, string]> = [
    ...runs.map((row): [string, string, string] => [
      "analysis",
      row.id,
      `${row.status}:${row.error ?? row.outcome ?? ""}:${row.updatedAt.toISOString()}`,
    ]),
    ...participation.map((row): [string, string, string] => [
      "participation",
      row.id,
      `${row.kind}:${row.occurredAt.toISOString()}`,
    ]),
    ...findings.map((row): [string, string, string] => [
      "finding",
      row.id,
      `${row.updatedAt.toISOString()}:${row.observedSessionCount}:${row.certainty}`,
    ]),
  ];
  const inputsHash = inputHash(rows);
  const summary: Omit<
    ExperimentSummary,
    "summary_id" | "revision" | "status" | "narrative" | "generated_at"
  > = {
    schema_version: "1.0",
    study_id: studyId,
    study_revision: studyRevision,
    baseline_commit_sha: plan.baseline.commit_sha,
    participation: { ...funnel, unknown: participation.length === 0 },
    sessions: { eligible: eligibleRuns.length, excluded, outcomes },
    themes,
    provenance,
    inputs_hash: inputsHash,
  };
  return { summary, inputsHash, productId: study.productId };
}

export async function enqueueSummary(
  tx: Tx | Db,
  tenantId: string,
  studyId: string,
  studyRevision: number,
): Promise<void> {
  const existing = await tx.query.jobs.findFirst({
    where: and(
      eq(schema.jobs.type, "summary.generate"),
      inArray(schema.jobs.status, ["queued", "running"]),
      sql`${schema.jobs.payload}->>'tenantId' = ${tenantId}`,
      sql`${schema.jobs.payload}->>'studyId' = ${studyId}`,
      sql`${schema.jobs.payload}->>'studyRevision' = ${String(studyRevision)}`,
    ),
  });
  if (existing) return;
  await enqueueJob(
    {
      type: "summary.generate",
      payload: { tenantId, studyId, studyRevision },
    },
    tx,
  );
}

export async function generateSummary(
  tenantId: string,
  studyId: string,
  studyRevision: number,
  deps: { provider?: SummaryProvider } = {},
) {
  const deterministic = await computeDeterministic(tenantId, studyId, studyRevision);
  const existing = await db.query.experimentSummaries.findFirst({
    where: and(
      eq(schema.experimentSummaries.tenantId, tenantId),
      eq(schema.experimentSummaries.studyId, studyId),
      eq(schema.experimentSummaries.studyRevision, studyRevision),
      eq(schema.experimentSummaries.inputsHash, deterministic.inputsHash),
    ),
  });
  if (existing) return existing;
  const latest = await db.query.experimentSummaries.findFirst({
    where: and(
      eq(schema.experimentSummaries.tenantId, tenantId),
      eq(schema.experimentSummaries.studyId, studyId),
      eq(schema.experimentSummaries.studyRevision, studyRevision),
    ),
    orderBy: desc(schema.experimentSummaries.revision),
  });
  const revision = (latest?.revision ?? 0) + 1;
  let status: ExperimentSummary["status"] =
    deterministic.summary.sessions.eligible === 0 ? "collecting" : "summarized";
  let narrative = emptyNarrative();
  let providerName: string | null = null;
  let providerSessionId: string | null = null;
  let providerSessionUrl: string | null = null;
  let error: string | null = null;
  const narrativeRaw: unknown[] = [];
  if (status !== "collecting" && deterministic.summary.themes.length > 0) {
    const provider = providerFor(env().SUMMARY_PROVIDER, deps.provider);
    providerName = provider.name;
    const providerInput: SummaryProviderInput = {
      study_id: studyId,
      participation: deterministic.summary.participation,
      sessions: {
        eligible: deterministic.summary.sessions.eligible,
        outcomes: deterministic.summary.sessions.outcomes,
      },
      themes: deterministic.summary.themes.map((theme) => ({
        finding_id: theme.finding_id,
        title: theme.title,
        category: theme.category,
        observation: theme.observation,
        hypothesis: theme.hypothesis,
        observed_session_count: theme.observed_session_count,
        eligible_session_count: theme.eligible_session_count,
        certainty: theme.certainty,
      })),
    };
    let result = await provider.summarize(
      providerInput,
      { id: newId("summary") },
      async (handle) => {
        providerSessionId = handle.sessionId ?? null;
        providerSessionUrl = handle.url ?? null;
      },
    );
    narrativeRaw.push(result.raw);
    const validate = (candidate: unknown) => {
      const parsed = SummaryNarrativeOutputSchema.safeParse(candidate);
      if (!parsed.success) return { parsed: null, problems: parsed.error.message };
      if (
        parsed.data.study_id !== studyId ||
        parsed.data.observations.some((item) =>
          item.finding_ids.some(
            (id) => !deterministic.summary.themes.some((theme) => theme.finding_id === id),
          ),
        )
      )
        return { parsed: null, problems: "narrative cited an unknown finding_id or study_id" };
      return { parsed: parsed.data, problems: "" };
    };
    let checked = validate(result.raw);
    if (!checked.parsed) {
      result = await provider.requestCorrection(result.handle, checked.problems);
      narrativeRaw.push(result.raw);
      checked = validate(result.raw);
    }
    if (!checked.parsed) {
      status = "failed";
      error = "invalid_narrative";
    } else {
      narrative = {
        headline: checked.parsed.headline,
        observations: checked.parsed.observations,
        limitations: checked.parsed.limitations,
      };
    }
  }
  const summaryId = newId("summary");
  const generatedAt = new Date();
  const finalSummary = ExperimentSummarySchema.parse({
    ...deterministic.summary,
    summary_id: summaryId,
    revision,
    status,
    narrative,
    generated_at: generatedAt.toISOString(),
  });
  const inserted = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.experimentSummaries)
      .values({
        id: summaryId,
        tenantId,
        studyId,
        studyRevision,
        revision,
        status,
        inputsHash: deterministic.inputsHash,
        summary: finalSummary,
        narrativeRaw,
        provider: providerName,
        providerSessionId,
        providerSessionUrl,
        error,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) return null;
    await emitEvent(tx, {
      type: "summary.generated",
      tenantId,
      productId: deterministic.productId,
      correlationId: studyId,
      idempotencyKey: `${summaryId}:summary_generated`,
      payload: {
        study_id: studyId,
        study_revision: studyRevision,
        summary_id: summaryId,
        revision,
        status,
      },
    });
    return row;
  });
  if (inserted) return inserted;
  const same = await db.query.experimentSummaries.findFirst({
    where: and(
      eq(schema.experimentSummaries.tenantId, tenantId),
      eq(schema.experimentSummaries.studyId, studyId),
      eq(schema.experimentSummaries.studyRevision, studyRevision),
      eq(schema.experimentSummaries.inputsHash, deterministic.inputsHash),
    ),
  });
  if (!same) throw new Error("summary_insert_failed");
  return same;
}

export async function latestSummary(tenantId: string, studyId: string) {
  const latest = await db.query.experimentSummaries.findFirst({
    where: and(
      eq(schema.experimentSummaries.tenantId, tenantId),
      eq(schema.experimentSummaries.studyId, studyId),
    ),
    orderBy: desc(schema.experimentSummaries.revision),
  });
  const revisions = await db
    .select({
      revision: schema.experimentSummaries.revision,
      status: schema.experimentSummaries.status,
      generated_at: schema.experimentSummaries.createdAt,
    })
    .from(schema.experimentSummaries)
    .where(
      and(
        eq(schema.experimentSummaries.tenantId, tenantId),
        eq(schema.experimentSummaries.studyId, studyId),
      ),
    )
    .orderBy(asc(schema.experimentSummaries.revision));
  return {
    latest,
    revisions: revisions.map((row) => ({ ...row, generated_at: row.generated_at.toISOString() })),
  };
}
