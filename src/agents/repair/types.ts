import type { ProviderHandle, ProviderResult } from "@/agents/types";

export type RepairContext = {
  repairRunId: string;
  repo: { owner: string; repo: string };
  baseCommitSha: string;
  branchName: string;
  finding: {
    title: string;
    category: string;
    semanticTarget: string;
    observation: string;
    hypothesis: string;
    suggestedExperiment: string | null;
    limitations: string[];
    reproductionSteps: string;
  };
  task: {
    participant_prompt: string;
    success_rule_ref: string;
  };
  allowedPaths: string[];
  invariants: string[];
};

export interface RepairProvider {
  name: string;
  start(
    context: RepairContext,
    onSession?: (handle: ProviderHandle) => Promise<void>,
  ): Promise<ProviderResult>;
  revise(handle: ProviderHandle, diagnostics: string): Promise<ProviderResult>;
}
