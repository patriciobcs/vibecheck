import { agentOutputSchema } from "@/contracts/agentOutput";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DiscoveryProvider } from "@/agents/types";
import { fixtureProvider } from "@/agents/fixture";
import { devinProvider } from "@/agents/devin";

export function providerFor(name: string, override?: DiscoveryProvider) {
  if (override) return override;
  return name === "devin" ? devinProvider : fixtureProvider;
}

const jsonValue = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export async function handleDiscoveryRun(runId: string, providerOverride?: DiscoveryProvider) {
  const run = await prisma.discoveryRun.findUnique({ where: { id: runId }, include: { product: true } });
  if (!run) throw new Error("run_not_found");
  await prisma.discoveryRun.update({ where: { id: runId }, data: { status: "inspecting" } });
  const provider = providerFor(run.provider, providerOverride);
  const context = {
    url: run.product.url, description: run.product.description, audience: run.product.audience,
    language: run.product.language, releaseNotes: run.product.releaseNotes,
    complaints: run.product.supportComplaints, journeys: run.product.knownJourneys,
    events: run.product.productEvents,
  };
  let result = await provider.propose(context, { id: run.id });
  const initialRaw = result.raw;
  let parsed = agentOutputSchema.safeParse(result.raw);
  await prisma.discoveryRun.update({ where: { id: run.id }, data: { providerSessionId: result.handle.sessionId, providerSessionUrl: result.handle.url, rawResponses: [jsonValue(result.raw)] } });
  if (!parsed.success) {
    const correction = await provider.requestCorrection(result.handle, parsed.error.message);
    result = correction;
    parsed = agentOutputSchema.safeParse(result.raw);
    await prisma.discoveryRun.update({ where: { id: run.id }, data: { correctionAttempts: 1, rawResponses: [jsonValue(initialRaw), jsonValue(result.raw)] } });
  }
  if (!parsed.success) {
    await prisma.discoveryRun.update({ where: { id: run.id }, data: { status: "failed", error: "malformed_agent_output" } });
    return;
  }
  await prisma.$transaction(async (tx) => {
    await tx.proposal.deleteMany({ where: { discoveryRunId: run.id } });
    if (parsed.data.outcome === "proposed") {
      await tx.proposal.createMany({ data: parsed.data.proposals.slice(0, 5).map((proposal) => ({
        discoveryRunId: run.id, tenantId: run.tenantId, taskId: proposal.task_id,
        researchQuestion: proposal.research_question, participantPrompt: proposal.participant_prompt,
        rationale: proposal.rationale, evidenceRefs: proposal.evidence_refs, evidenceType: proposal.evidence_type,
        eligibilityRuleRef: proposal.eligibility_rule_ref, successRuleRef: proposal.success_rule_ref,
        uncertainties: proposal.uncertainties, estimatedDurationSeconds: proposal.estimated_duration_seconds,
        confidence: proposal.confidence,
      })) });
    }
    await tx.discoveryRun.update({ where: { id: run.id }, data: { status: "proposed", outcome: parsed.data.outcome, outcomeReason: parsed.data.outcome_reason } });
  });
}
