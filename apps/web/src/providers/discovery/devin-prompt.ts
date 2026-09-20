import {
  agentOutputJsonSchema,
  ELIGIBILITY_RULE_REFS,
  MAX_PROPOSALS,
  SUCCESS_RULE_REFS,
} from "@vibecheck/contracts";
import type { DiscoveryContext } from "./types";

export function buildDiscoveryPrompt(context: DiscoveryContext, runId: string): string {
  const candidates = context.sourceCandidates?.length
    ? `\nPassive-screening research candidates are included under source_candidates. Convert a suspected problem into a neutral task only when evidence supports it; cite candidate ids in source_candidate_refs; never expose the suspected failure or any score to participants.`
    : "";
  const scope = context.release_notes.length
    ? "Prioritize the recently shipped features listed in release notes."
    : "No release notes were supplied. Inspect the app URL and use any product description, audience and known journeys to propose exploratory tasks for its core user goals. Do not assume release notes or complaints exist.";
  return `You are performing read-only UX discovery for Seamless UX run ${runId}.
Echo this source_revision verbatim in your output: ${context.sourceRevision}.
${scope}
Return at most ${MAX_PROPOSALS} proposals. Items marked isSample:true are sample data and must be described
as sample data in the rationale. When product_events is empty, proposals are
exploratory and must say so in uncertainties.${candidates}

Participant prompts describe a goal without naming controls or shortcuts or a
suspected problem. Do not browse private networks or modify anything. If the URL is
unreachable return needs_setup. If context is insufficient return cannot_assess.
Do not invent traffic, complaints or observed failures. Distinguish signal from
hypothesis. Use only these success_rule_ref values: ${SUCCESS_RULE_REFS.join(", ")}.
Use only these eligibility_rule_ref values: ${ELIGIBILITY_RULE_REFS.join(", ")}.
If no registered success and eligibility rules fit the product, return cannot_assess
and explain the missing setup rather than applying an unrelated demo rule.
For every proposal, include a neutral agent-designed scenario with a short intro,
present-tense imperative steps, and optional think-aloud cues. Do not name controls,
leak a hypothesis, or ask the participant to be negative.
Return only this exact JSON shape:
${JSON.stringify(agentOutputJsonSchema)}

Context:
${JSON.stringify(context, null, 2)}`;
}
