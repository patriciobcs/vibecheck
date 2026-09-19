import { analysisOutputJsonSchema } from "@/contracts/analysisOutput";
import type { AnalysisProvider } from "./types";
import { buildAnalysisPrompt } from "./prompt";
import { createDevinSession, messageDevinSession, pollDevinSession } from "../devin/client";

export const devinAnalysisProvider: AnalysisProvider = {
  name: "devin",
  async analyse(evidence, run, onSession) {
    const handle = await createDevinSession({
      prompt: buildAnalysisPrompt(evidence),
      title: `VibeCheck analysis ${run.id}`,
      tags: ["vibecheck", "analysis"],
      structuredOutputSchema: analysisOutputJsonSchema,
    });
    await onSession?.(handle);
    return pollDevinSession(handle);
  },
  async requestCorrection(handle, problems) {
    return messageDevinSession(handle, `Correct the JSON output. Problems: ${problems}`);
  },
};
