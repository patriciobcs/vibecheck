import type { ExperimentSummary, SummaryNarrativeOutput } from "@vibecheck/contracts";
import type { ProviderHandle, ProviderResult } from "@/providers/analysis/types";

export type SummaryProviderInput = {
  study_id: string;
  participation: ExperimentSummary["participation"];
  sessions: Pick<ExperimentSummary["sessions"], "eligible" | "outcomes">;
  themes: Array<{
    finding_id: string;
    title: string;
    category: string;
    observation: string;
    hypothesis: string;
    observed_session_count: number;
    eligible_session_count: number;
    certainty: string;
  }>;
};

export interface SummaryProvider {
  name: string;
  summarize(
    input: SummaryProviderInput,
    run: { id: string },
    onSession?: (handle: ProviderHandle) => Promise<void>,
  ): Promise<ProviderResult>;
  requestCorrection(handle: ProviderHandle, problems: string): Promise<ProviderResult>;
}

export type ParsedSummaryNarrative = SummaryNarrativeOutput;
