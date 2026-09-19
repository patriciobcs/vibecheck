import { agentOutputSchema } from "@/contracts/agentOutput";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DiscoveryProvider } from "@/agents/types";
import { fixtureProvider } from "@/agents/fixture";
import { devinProvider } from "@/agents/devin";

export function providerFor(name: string, override?: DiscoveryProvider) {
  if (override) return override;
  if (name === "devin") return devinProvider;
  if (name === "fixture") return fixtureProvider;
  throw new Error("unknown_provider");
}

const jsonValue = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export async function markDiscoveryRunFailed(runId: string, error: unknown) {
  await prisma.discoveryRun.update({
    where: { id: runId },
    data: { status: "failed", error: error instanceof Error ? error.message : "job_failed" },
  });
}

export async function handleDiscoveryRun(runId: string, providerOverride?: DiscoveryProvider) {
  const run = await prisma.discoveryRun.findUnique({ where: { id: runId }, include: { product: true } });
  if (!run) throw new Error("run_not_found");
  await prisma.discoveryRun.update({ where: { id: runId }, data: { status: "inspecting" } });
  const provider = providerFor(run.provider, providerOverride);
  const context = {
    url: run.product.url, description: run.product.description, audience: run.product.audience,
    language: run.product.language, sourceRevision: run.sourceRevision, releaseNotes: run.product.releaseNotes,
    complaints: run.product.supportComplaints, journeys: run.product.knownJourneys,
    events: run.product.productEvents,
  };
  let result = await provider.propose(context, { id: run.id }, async (handle) => {
    await prisma.discoveryRun.update({
      where: { id: run.id },
      data: { providerSessionId: handle.sessionId, providerSessionUrl: handle.url },
    });
  });
  const initialRaw = result.raw;
  let parsed = agentOutputSchema.safeParse(result.raw);
  let contextMatches = parsed.success && parsed.data.discovery_run_id === run.id && parsed.data.source_revision === run.sourceRevision;
  await prisma.discoveryRun.update({ where: { id: run.id }, data: { providerSessionId: result.handle.sessionId, providerSessionUrl: result.handle.url, rawResponses: [jsonValue(result.raw)] } });
  if (!parsed.success || !contextMatches) {
    const problems = parsed.success ? "discovery_run_id or source_revision mismatch" : parsed.error.message;
    const correction = await provider.requestCorrection(result.handle, problems);
    result = correction;
    parsed = agentOutputSchema.safeParse(result.raw);
    contextMatches = parsed.success && parsed.data.discovery_run_id === run.id && parsed.data.source_revision === run.sourceRevision;
    await prisma.discoveryRun.update({ where: { id: run.id }, data: { correctionAttempts: 1, rawResponses: [jsonValue(initialRaw), jsonValue(result.raw)] } });
  }
  if (!parsed.success || !contextMatches) {
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
