import { agentOutputSchema } from "@/contracts/agentOutput";
import type { DiscoveryProvider } from "@/agents/types";
import { fixtureProvider } from "@/agents/fixture";
import { devinProvider } from "@/agents/devin";
import { toProductConfig } from "@/services/products";
import { ELIGIBILITY_RULE_REFS, SUCCESS_RULE_REFS } from "@/contracts/rules";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { discoveryRun, product, proposal } from "@/db/schema";

export function providerFor(name: string, override?: DiscoveryProvider) {
  if (override) return override;
  if (name === "devin") return devinProvider;
  if (name === "fixture") return fixtureProvider;
  throw new Error("unknown_provider");
}

export async function markDiscoveryRunFailed(runId: string, error: unknown, tenantId?: string) {
  await db
    .update(discoveryRun)
    .set({ status: "failed", error: error instanceof Error ? error.message : "job_failed" })
    .where(
      tenantId
        ? and(eq(discoveryRun.id, runId), eq(discoveryRun.tenantId, tenantId))
        : eq(discoveryRun.id, runId),
    );
}

export async function markDiscoveryRunQueued(runId: string, tenantId?: string) {
  await db
    .update(discoveryRun)
    .set({ status: "queued" })
    .where(
      tenantId
        ? and(eq(discoveryRun.id, runId), eq(discoveryRun.tenantId, tenantId))
        : eq(discoveryRun.id, runId),
    );
}

export async function handleDiscoveryRun(
  runId: string,
  providerOverride?: DiscoveryProvider,
  tenantId?: string,
) {
  const [run] = await db
    .select()
    .from(discoveryRun)
    .where(
      tenantId
        ? and(eq(discoveryRun.id, runId), eq(discoveryRun.tenantId, tenantId))
        : eq(discoveryRun.id, runId),
    )
    .limit(1);
  if (!run) throw new Error("run_not_found");
  const [runProduct] = await db
    .select()
    .from(product)
    .where(and(eq(product.id, run.productId), eq(product.tenantId, run.tenantId)))
    .limit(1);
  if (!runProduct) throw new Error("product_not_found");
  await db.update(discoveryRun).set({ status: "inspecting" }).where(eq(discoveryRun.id, runId));
  const provider = providerFor(run.provider, providerOverride);
  const context = { ...toProductConfig(runProduct), sourceRevision: run.sourceRevision };
  let result = await provider.propose(context, { id: run.id }, async (handle) => {
    const session = {
      ...(handle.sessionId ? { providerSessionId: handle.sessionId } : {}),
      ...(handle.url ? { providerSessionUrl: handle.url } : {}),
    };
    if (Object.keys(session).length === 0) return;
    await db.update(discoveryRun).set(session).where(eq(discoveryRun.id, run.id));
  });
  const initialRaw = result.raw;
  let parsed = agentOutputSchema.safeParse(result.raw);
  let contextMatches =
    parsed.success &&
    parsed.data.discovery_run_id === run.id &&
    parsed.data.source_revision === run.sourceRevision;
  let ruleRefsValid =
    parsed.success &&
    parsed.data.proposals.every(
      (proposal) =>
        SUCCESS_RULE_REFS.includes(
          proposal.success_rule_ref as (typeof SUCCESS_RULE_REFS)[number],
        ) &&
        ELIGIBILITY_RULE_REFS.includes(
          proposal.eligibility_rule_ref as (typeof ELIGIBILITY_RULE_REFS)[number],
        ),
    );
  await db
    .update(discoveryRun)
    .set({
      providerSessionId: result.handle.sessionId,
      providerSessionUrl: result.handle.url,
      rawResponses: [result.raw],
    })
    .where(eq(discoveryRun.id, run.id));
  if (!parsed.success || !contextMatches || !ruleRefsValid) {
    const problems = parsed.success
      ? !contextMatches
        ? "discovery_run_id or source_revision mismatch"
        : `unknown rule ref; allowed success_rule_ref values: ${SUCCESS_RULE_REFS.join(", ")}; allowed eligibility_rule_ref values: ${ELIGIBILITY_RULE_REFS.join(", ")}`
      : parsed.error.message;
    const correction = await provider.requestCorrection(result.handle, problems);
    result = correction;
    parsed = agentOutputSchema.safeParse(result.raw);
    contextMatches =
      parsed.success &&
      parsed.data.discovery_run_id === run.id &&
      parsed.data.source_revision === run.sourceRevision;
    ruleRefsValid =
      parsed.success &&
      parsed.data.proposals.every(
        (proposal) =>
          SUCCESS_RULE_REFS.includes(
            proposal.success_rule_ref as (typeof SUCCESS_RULE_REFS)[number],
          ) &&
          ELIGIBILITY_RULE_REFS.includes(
            proposal.eligibility_rule_ref as (typeof ELIGIBILITY_RULE_REFS)[number],
          ),
      );
    await db
      .update(discoveryRun)
      .set({ correctionAttempts: 1, rawResponses: [initialRaw, result.raw] })
      .where(eq(discoveryRun.id, run.id));
  }
  if (!parsed.success || !contextMatches || !ruleRefsValid) {
    await db
      .update(discoveryRun)
      .set({ status: "failed", error: "malformed_agent_output" })
      .where(eq(discoveryRun.id, run.id));
    return;
  }
  await db.transaction(async (tx) => {
    await tx.delete(proposal).where(eq(proposal.discoveryRunId, run.id));
    if (parsed.data.outcome === "proposed") {
      await tx.insert(proposal).values(
        parsed.data.proposals.map((item) => ({
          discoveryRunId: run.id,
          tenantId: run.tenantId,
          taskId: item.task_id,
          researchQuestion: item.research_question,
          participantPrompt: item.participant_prompt,
          rationale: item.rationale,
          evidenceRefs: item.evidence_refs,
          evidenceType: item.evidence_type,
          eligibilityRuleRef: item.eligibility_rule_ref,
          successRuleRef: item.success_rule_ref,
          uncertainties: item.uncertainties,
          estimatedDurationSeconds: item.estimated_duration_seconds,
          confidence: item.confidence,
        })),
      );
    }
    await tx
      .update(discoveryRun)
      .set({
        status: "proposed",
        outcome: parsed.data.outcome,
        outcomeReason: parsed.data.outcome_reason,
      })
      .where(eq(discoveryRun.id, run.id));
  });
}
