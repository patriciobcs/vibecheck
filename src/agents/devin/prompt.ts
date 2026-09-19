import type { DiscoveryContext } from "../types";

export function buildPrompt(context: DiscoveryContext, runId: string) {
  return `You are performing read-only UX discovery for VibeCheck run ${runId}.
Do not mutate code, name controls in participant prompts, invent traffic or complaints,
or treat hypotheses as observations. Use signal versus hypothesis labels. If product
events are empty, label proposals exploratory. Return cannot_assess or needs_setup
when appropriate. Return only the required JSON agent output shape.

Context:
${JSON.stringify(context, null, 2)}`;
}
