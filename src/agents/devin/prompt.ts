import type { DiscoveryContext } from "../types";
import { agentOutputJsonSchema } from "@/contracts/agentOutput";

export function buildPrompt(context: DiscoveryContext, runId: string) {
  return `You are performing read-only UX discovery for VibeCheck run ${runId}.
Echo this source_revision verbatim in your output: ${context.sourceRevision}.
Propose tasks only for the recently shipped features listed in release notes, with at
most 3 proposals. Items marked isSample:true are sample data and must be described
as sample data in the rationale. When product_events is empty, proposals are
exploratory and must say so in uncertainties.

Participant prompts describe a goal without naming controls or shortcuts or a
suspected problem. Do not browse private networks or modify anything. If the URL is
unreachable return needs_setup. If context is insufficient return cannot_assess.
Do not invent traffic, complaints or observed failures. Distinguish signal from
hypothesis. Return only this exact JSON shape:
${JSON.stringify(agentOutputJsonSchema)}

Context:
${JSON.stringify(context, null, 2)}`;
}
