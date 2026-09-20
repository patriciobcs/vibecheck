import type { EvidencePackage } from "@vibecheck/contracts";

export type ProviderHandle = {
  sessionId?: string;
  url?: string;
  runId?: string;
  branchName?: string;
};
export type ProviderResult = { raw: unknown; handle: ProviderHandle };

export interface AnalysisProvider {
  name: string;
  analyse(
    evidence: EvidencePackage,
    run: { id: string },
    onSession?: (handle: ProviderHandle) => Promise<void>,
  ): Promise<ProviderResult>;
  requestCorrection(handle: ProviderHandle, problems: string): Promise<ProviderResult>;
}
