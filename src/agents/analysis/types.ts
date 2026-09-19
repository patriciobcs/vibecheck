import type { EvidencePackage } from "@/contracts/evidencePackage";
import type { ProviderHandle, ProviderResult } from "@/agents/types";

export interface AnalysisProvider {
  name: string;
  analyse(
    evidence: EvidencePackage,
    run: { id: string },
    onSession?: (handle: ProviderHandle) => Promise<void>,
  ): Promise<ProviderResult>;
  requestCorrection(handle: ProviderHandle, problems: string): Promise<ProviderResult>;
}
