import { agentOutputJsonSchema } from "@/contracts/agentOutput";
import type { DiscoveryContext, DiscoveryProvider, ProviderHandle, ProviderResult } from "../types";
import { buildPrompt } from "./prompt";
import { createDevinSession, messageDevinSession, pollDevinSession } from "./client";

export const devinProvider: DiscoveryProvider = {
  name: "devin",
  async propose(context, run, onSession) {
    const handle = await createDevinSession({
      prompt: buildPrompt(context, run.id),
      title: `VibeCheck discovery ${run.id}`,
      tags: ["vibecheck", "discovery"],
      structuredOutputSchema: agentOutputJsonSchema,
    });
    await onSession?.(handle);
    return pollDevinSession(handle);
  },
  async requestCorrection(handle, problems) {
    return messageDevinSession(handle, `Correct the JSON output. Problems: ${problems}`);
  },
};
