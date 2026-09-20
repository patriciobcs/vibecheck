import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { db } from "@/db";
import {
  analysisRun,
  experimentSummary,
  finding,
  job,
  outboxEvent,
  repairRun,
  study,
  studyPlanRevision,
  participationEvent,
} from "@/db/schema";
import {
  experimentSummarySchema,
  summaryNarrativeOutputSchema,
  type ExperimentSummary,
  type SummaryNarrativeOutput,
} from "@/contracts/experimentSummary";
import { devinSummaryProvider } from "@/agents/summary/devin";
import { fixtureSummaryProvider } from "@/agents/summary/fixture";
import type { SummaryProvider, SummaryProviderInput } from "@/agents/summary/types";

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

function asDate(value: Date | null | undefined) {
  return value?.toISOString() ?? "";
}

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
  if (name === "devin") return devinSummaryProvider;
  return fixtureSummaryProvider;
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
  const [studyRow] = await db
    .select()
    .from(study)
    .where(and(eq(study.id, studyId), eq(study.tenantId, tenantId)))
    .limit(1);
  if (!studyRow) throw new Error("study_not_found");
  const [planRow] = await db
    .select()
    .from(studyPlanRevision)
    .where(
      and(eq(studyPlanRevision.studyId, studyId), eq(studyPlanRevision.revision, studyRevision)),
    )
    .limit(1);
  if (!planRow) throw new Error("study_plan_not_found");
  const runs = await db
    .select()
    .from(analysisRun)
    .where(and(eq(analysisRun.studyId, studyId), eq(analysisRun.tenantId, tenantId)));
  const participation = await db
    .select()
    .from(participationEvent)
    .where(
      and(
        eq(participationEvent.studyId, studyId),
        eq(participationEvent.tenantId, tenantId),
        eq(participationEvent.studyRevision, studyRevision),
      ),
    );
  const findings = await db
    .select()
    .from(finding)
    .where(
      and(
        eq(finding.studyId, studyId),
        eq(finding.tenantId, tenantId),
        eq(finding.studyRevision, studyRevision),
      ),
    );
  const repairs = findings.length
    ? await db
        .select()
        .from(repairRun)
        .where(
          and(
            eq(repairRun.tenantId, tenantId),
            inArray(
              repairRun.findingId,
              findings.map((row) => row.id),
            ),
          ),
        )
    : [];
  const repairByFinding = new Map(repairs.map((row) => [row.findingId, row.status]));
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
    if (run.status !== "completed" || !run.evidencePackage) {
      const reason =
        run.error === "baseline_mismatch" || run.outcome === "baseline_mismatch"
          ? "baseline_mismatch"
          : run.error === "incomplete_session" ||
              run.error === "incomplete_capture" ||
              run.evidencePackage?.completeness !== "complete"
            ? "incomplete_capture"
            : "analysis_failed";
      excluded.push({ session_id: run.sessionId, reason });
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
      repair_status: repairByFinding.get(row.id) ?? null,
    }));
  const provenance = strictestProvenance(findings.map((row) => row.provenance));
  const rows: Array<[string, string, string]> = [
    ...runs.map((row): [string, string, string] => [
      "analysis",
      row.id,
      `${row.status}:${row.error ?? row.outcome ?? ""}:${asDate(row.updatedAt)}`,
    ]),
    ...participation.map((row): [string, string, string] => [
      "participation",
      row.id,
      `${row.kind}:${asDate(row.createdAt)}`,
    ]),
    ...findings.map((row): [string, string, string] => [
      "finding",
      row.id,
      `${row.updatedAt.toISOString()}:${row.observedSessionCount}:${row.certainty}`,
    ]),
    ...repairs.map((row): [string, string, string] => [
      "repair",
      row.id,
      `${row.status}:${asDate(row.updatedAt)}`,
    ]),
  ];
  const inputsHash = inputHash(rows);
  const summary: Omit<
    ExperimentSummary,
    "summary_id" | "revision" | "status" | "narrative" | "generated_at"
  > & {
    sessions: ExperimentSummary["sessions"];
    themes: ExperimentSummary["themes"];
  } = {
    schema_version: "1.0",
    study_id: studyId,
    study_revision: studyRevision,
    baseline_commit_sha: planRow.plan.baseline.commit_sha,
    participation: { ...funnel, unknown: participation.length === 0 },
    sessions: {
      eligible: eligibleRuns.length,
      excluded,
      outcomes,
    },
    themes,
    provenance,
    inputs_hash: inputsHash,
  };
  return { summary, inputsHash, plan: planRow.plan };
}

export async function enqueueSummary(
  tx: Tx | Db,
  tenantId: string,
  studyId: string,
  studyRevision: number,
) {
  const existing = await tx
    .select({ id: job.id, payload: job.payload })
    .from(job)
    .where(
      and(
        eq(job.tenantId, tenantId),
        eq(job.type, "summary.generate"),
        or(eq(job.status, "pending"), eq(job.status, "running")),
      ),
    );
  if (
    existing.some(
      (row) =>
        typeof row.payload === "object" &&
        row.payload !== null &&
        "studyId" in row.payload &&
        "studyRevision" in row.payload &&
        (row.payload as { studyId?: unknown }).studyId === studyId &&
        (row.payload as { studyRevision?: unknown }).studyRevision === studyRevision,
    )
  )
    return;
  await tx.insert(job).values({
    type: "summary.generate",
    tenantId,
    payload: { studyId, studyRevision },
  });
}

export async function generateSummary(
  tenantId: string,
  studyId: string,
  studyRevision: number,
  deps: { provider?: SummaryProvider } = {},
) {
  const deterministic = await computeDeterministic(tenantId, studyId, studyRevision);
  const [existing] = await db
    .select()
    .from(experimentSummary)
    .where(
      and(
        eq(experimentSummary.tenantId, tenantId),
        eq(experimentSummary.studyId, studyId),
        eq(experimentSummary.studyRevision, studyRevision),
        eq(experimentSummary.inputsHash, deterministic.inputsHash),
      ),
    )
    .limit(1);
  if (existing) return existing;
  const [latest] = await db
    .select({ revision: experimentSummary.revision })
    .from(experimentSummary)
    .where(
      and(
        eq(experimentSummary.tenantId, tenantId),
        eq(experimentSummary.studyId, studyId),
        eq(experimentSummary.studyRevision, studyRevision),
      ),
    )
    .orderBy(desc(experimentSummary.revision))
    .limit(1);
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
    const provider = providerFor(process.env.SUMMARY_PROVIDER ?? "fixture", deps.provider);
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
    const handleSession = async (handle: { sessionId?: string; url?: string }) => {
      providerSessionId = handle.sessionId ?? null;
      providerSessionUrl = handle.url ?? null;
    };
    let result = await provider.summarize(providerInput, { id: randomUUID() }, handleSession);
    narrativeRaw.push(result.raw);
    let parsed = summaryNarrativeOutputSchema.safeParse(result.raw);
    const validate = (candidate: SummaryNarrativeOutput | undefined) =>
      candidate?.study_id === studyId &&
      candidate.observations.every((item) =>
        item.finding_ids.every((id) =>
          deterministic.summary.themes.some((theme) => theme.finding_id === id),
        ),
      );
    if (!parsed.success || !validate(parsed.data)) {
      const problems = !parsed.success
        ? parsed.error.message
        : "narrative cited an unknown finding_id or study_id";
      result = await provider.requestCorrection(result.handle, problems);
      narrativeRaw.push(result.raw);
      parsed = summaryNarrativeOutputSchema.safeParse(result.raw);
    }
    if (!parsed.success || !validate(parsed.data)) {
      status = "failed";
      error = "invalid_narrative";
    } else {
      narrative = {
        headline: parsed.data.headline,
        observations: parsed.data.observations,
        limitations: parsed.data.limitations,
      };
    }
  }
  const id = randomUUID();
  const generatedAt = new Date();
  const finalSummary = experimentSummarySchema.parse({
    ...deterministic.summary,
    summary_id: id,
    revision,
    status,
    narrative,
    generated_at: generatedAt.toISOString(),
  });
  const [inserted] = await db
    .insert(experimentSummary)
    .values({
      id,
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
  if (!inserted) {
    const [same] = await db
      .select()
      .from(experimentSummary)
      .where(
        and(
          eq(experimentSummary.tenantId, tenantId),
          eq(experimentSummary.studyId, studyId),
          eq(experimentSummary.studyRevision, studyRevision),
          eq(experimentSummary.inputsHash, deterministic.inputsHash),
        ),
      )
      .limit(1);
    if (!same) throw new Error("summary_insert_failed");
    return same;
  }
  await db.transaction(async (tx) => {
    await tx
      .update(study)
      .set({ latestSummaryId: inserted.id })
      .where(and(eq(study.id, studyId), eq(study.tenantId, tenantId)));
    await tx
      .insert(outboxEvent)
      .values({
        eventId: randomUUID(),
        eventType: "summary.generated",
        idempotencyKey: `${inserted.id}:summary_generated`,
        tenantId,
        productId:
          (
            await tx
              .select({ productId: study.productId })
              .from(study)
              .where(eq(study.id, studyId))
              .limit(1)
          )[0]?.productId ?? "",
        correlationId: studyId,
        payload: {
          study_id: studyId,
          study_revision: studyRevision,
          summary_id: inserted.id,
          revision,
          status,
        },
        occurredAt: generatedAt,
      })
      .onConflictDoNothing({ target: outboxEvent.idempotencyKey });
  });
  return inserted;
}
