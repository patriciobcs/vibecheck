import { repairOutputJsonSchema } from "@/contracts/repairOutput";
import type { ProviderHandle, ProviderResult } from "@/agents/types";
import { createDevinSession, messageDevinSession, pollDevinSession } from "@/agents/devin/client";
import { buildRepairPrompt } from "./prompt";
import type { RepairContext, RepairProvider } from "./types";

export const devinRepairProvider: RepairProvider = {
  name: "devin",
  async start(context, onSession) {
    const handle = await createDevinSession({
      prompt: buildRepairPrompt(context),
      title: `VibeCheck repair ${context.repairRunId}`,
      tags: ["vibecheck", "repair"],
      structuredOutputSchema: repairOutputJsonSchema,
    });
    await onSession?.(handle);
    return pollDevinSession(handle);
  },
  async revise(handle: ProviderHandle, diagnostics: string): Promise<ProviderResult> {
    return messageDevinSession(
      handle,
      `Correct the candidate and return only the repair JSON. Diagnostics: ${diagnostics}`,
    );
  },
};
