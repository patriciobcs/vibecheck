import {
  AgentOutputSchema,
  ELIGIBILITY_RULE_REFS,
  isEligibilityRuleRef,
  isSuccessRuleRef,
  SUCCESS_RULE_REFS,
} from "@vibecheck/contracts";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { env } from "@/lib/env";
import { newId } from "@/lib/ids";
import { createDevinDiscoveryProvider } from "@/providers/discovery/devin";
import { fixtureDiscoveryProvider } from "@/providers/discovery/fixture";
import type { DiscoveryProvider } from "@/providers/discovery/types";
import { toProductConfig } from "./products";

export function discoveryProviderFor(name: string): DiscoveryProvider {
  if (name === "fixture") return fixtureDiscoveryProvider;
  if (name === "devin") {
    const cfg = env().devin;
    if (!cfg) throw new Error("devin_not_configured");
    return createDevinDiscoveryProvider(cfg);
  }
  throw new Error("unknown_provider");
}

export async function markDiscoveryRunFailed(runId: string, error: unknown) {
  await db
    .update(schema.discoveryRuns)
    .set({
      status: "failed",
      error: error instanceof Error ? error.message : "job_failed",
      updatedAt: new Date(),
    })
    .where(eq(schema.discoveryRuns.id, runId));
}

export async function markDiscoveryRunQueued(runId: string) {
  await db
    .update(schema.discoveryRuns)
    .set({ status: "queued", updatedAt: new Date() })
    .where(eq(schema.discoveryRuns.id, runId));
}

function validate(raw: unknown, run: { id: string; sourceRevision: string }) {
  const parsed = AgentOutputSchema.safeParse(raw);
  if (!parsed.success)
    return {
      ok: false as const,
      problems: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    };
  if (
    parsed.data.discovery_run_id !== run.id ||
    parsed.data.source_revision !== run.sourceRevision
  ) {
    return { ok: false as const, problems: "discovery_run_id or source_revision mismatch" };
  }
  const badRule = parsed.data.proposals.find(
    (p) => !isSuccessRuleRef(p.success_rule_ref) || !isEligibilityRuleRef(p.eligibility_rule_ref),
  );
  if (badRule) {
    return {
      ok: false as const,
      problems: `unknown rule ref; allowed success_rule_ref values: ${SUCCESS_RULE_REFS.join(", ")}; allowed eligibility_rule_ref values: ${ELIGIBILITY_RULE_REFS.join(", ")}`,
    };
  }
  return { ok: true as const, data: parsed.data };
}

/**
 * Runs one discovery job: read-only agent inspection, schema + rule validation, exactly one
 * correction request on malformed output, then proposals or an explicit non-proposal outcome.
 * Malformed output never becomes permission to publish.
 */
export async function handleDiscoveryRun(runId: string, providerOverride?: DiscoveryProvider) {
  const run = await db.query.discoveryRuns.findFirst({ where: eq(schema.discoveryRuns.id, runId) });
  if (!run) throw new Error("run_not_found");
  const product = await db.query.products.findFirst({
    where: and(eq(schema.products.id, run.productId), eq(schema.products.tenantId, run.tenantId)),
  });
  if (!product) throw new Error("product_not_found");

  await db
    .update(schema.discoveryRuns)
    .set({ status: "inspecting", updatedAt: new Date() })
    .where(eq(schema.discoveryRuns.id, run.id));
  const provider = providerOverride ?? discoveryProviderFor(run.provider);

  const candidates = run.sourceCandidateRefs.length
    ? await db.query.researchCandidates.findMany({
        where: inArray(schema.researchCandidates.id, run.sourceCandidateRefs),
      })
    : [];
  const context = {
    ...toProductConfig(product),
    sourceRevision: run.sourceRevision,
    ...(candidates.length
      ? {
          sourceCandidates: candidates.map((c) => ({
            candidate_id: c.id,
            journey_id: c.journeyId,
            target_ref: c.targetRef,
            category: c.category,
            suspected_problem: c.suspectedProblem,
            evidence_limitations: c.evidenceLimitations,
            distinct_observation_sessions: c.distinctObservationSessions,
          })),
        }
      : {}),
  };

  let result = await provider.propose(context, { id: run.id }, async (handle) => {
    await db
      .update(schema.discoveryRuns)
      .set({
        providerSessionId: handle.sessionId ?? null,
        providerSessionUrl: handle.url ?? null,
        updatedAt: new Date(),
      })
      .where(eq(schema.discoveryRuns.id, run.id));
  });
  const initialRaw = result.raw;
  let check = validate(result.raw, run);
  await db
    .update(schema.discoveryRuns)
    .set({
      providerSessionId: result.handle.sessionId ?? null,
      providerSessionUrl: result.handle.url ?? null,
      rawResponses: [result.raw],
      updatedAt: new Date(),
    })
    .where(eq(schema.discoveryRuns.id, run.id));

  if (!check.ok) {
    result = await provider.requestCorrection(result.handle, check.problems);
    check = validate(result.raw, run);
    await db
      .update(schema.discoveryRuns)
      .set({ correctionAttempts: 1, rawResponses: [initialRaw, result.raw], updatedAt: new Date() })
      .where(eq(schema.discoveryRuns.id, run.id));
  }
  if (!check.ok) {
    await db
      .update(schema.discoveryRuns)
      .set({ status: "failed", error: "malformed_agent_output", updatedAt: new Date() })
      .where(eq(schema.discoveryRuns.id, run.id));
    return;
  }

  const data = check.data;
  await db.transaction(async (tx) => {
    await tx.delete(schema.proposals).where(eq(schema.proposals.discoveryRunId, run.id));
    if (data.outcome === "proposed" && data.proposals.length > 0) {
      await tx.insert(schema.proposals).values(
        data.proposals.map((p) => ({
          id: newId("proposal"),
          tenantId: run.tenantId,
          discoveryRunId: run.id,
          taskId: p.task_id,
          researchQuestion: p.research_question,
          participantPrompt: p.participant_prompt,
          rationale: p.rationale,
          evidenceRefs: p.evidence_refs,
          evidenceType: p.evidence_type,
          eligibilityRuleRef: p.eligibility_rule_ref,
          successRuleRef: p.success_rule_ref,
          uncertainties: p.uncertainties,
          estimatedDurationSeconds: p.estimated_duration_seconds ?? null,
          confidence: p.confidence ?? null,
          sourceCandidateRefs: p.source_candidate_refs ?? [],
        })),
      );
    }
    await tx
      .update(schema.discoveryRuns)
      .set({
        status: "proposed",
        outcome: data.outcome,
        outcomeReason: data.outcome_reason ?? null,
        updatedAt: new Date(),
      })
      .where(eq(schema.discoveryRuns.id, run.id));
  });
}
