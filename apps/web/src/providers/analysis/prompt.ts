import type { EvidencePackage } from "@vibecheck/contracts";
import { AnalysisOutputJsonSchema, MAX_FINDINGS } from "@vibecheck/contracts";

export function buildAnalysisPrompt(evidence: EvidencePackage) {
  return `You are analysing ONE recorded usability session for VibeCheck. Evidence package id: ${evidence.evidence_package_id}. Session id: ${evidence.session_id}.
Echo both ids verbatim. You are given a neutral task, outcomes, bounded semantic events, transcript segments with ids,
and media references you cannot watch. Never claim to have seen video. Cite only actual event and segment ids and ranges.
Each finding title must use sentence case and present tense in the format <Area>: <problem>, with an area of 1 to 3 words.
State the problem, not the fix; do not include participant-specific content, trailing periods, or all-caps titles.
Examples: "Toolbar: sticky note tool is hard to discover" and
"Export dialog: transparent background option is easy to miss".
Quotes must be verbatim substrings of cited transcript segments. Return no more than ${MAX_FINDINGS} findings.
Return only JSON matching this schema:
${JSON.stringify(AnalysisOutputJsonSchema)}

Evidence package:
${JSON.stringify(evidence)}`;
}
