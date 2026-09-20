import { summaryNarrativeOutputJsonSchema } from "@/contracts/experimentSummary";
import type { SummaryProviderInput } from "./types";

export function buildSummaryPrompt(input: SummaryProviderInput) {
  return `You are summarizing one VibeCheck experiment. Return only JSON matching this schema:
${JSON.stringify(summaryNarrativeOutputJsonSchema)}
The deterministic counts are authoritative. Write a concise headline, 3 to 5 observations,
and limitations. Every observation must cite one or more finding_id values from the themes.
Do not mention participant identities, session IDs, transcripts, media, evidence references, or
unverified claims. Do not invent counts; the UI renders counts from the deterministic summary.

Summary input:
${JSON.stringify(input)}`;
}
