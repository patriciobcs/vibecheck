import { summaryNarrativeOutputJsonSchema } from "@/contracts/experimentSummary";
import { createDevinSession, messageDevinSession, pollDevinSession } from "../devin/client";
import { buildSummaryPrompt } from "./prompt";
import type { SummaryProvider } from "./types";

export const devinSummaryProvider: SummaryProvider = {
  name: "devin",
  async summarize(input, run, onSession) {
    const handle = await createDevinSession({
      prompt: buildSummaryPrompt(input),
      title: `VibeCheck experiment summary ${run.id}`,
      tags: ["vibecheck", "summary"],
      structuredOutputSchema: summaryNarrativeOutputJsonSchema,
    });
    await onSession?.(handle);
    return pollDevinSession(handle);
  },
  async requestCorrection(handle, problems) {
    return messageDevinSession(
      handle,
      `Correct the JSON output. Every finding_id must be one of the supplied theme IDs. Problems: ${problems}`,
    );
  },
};
