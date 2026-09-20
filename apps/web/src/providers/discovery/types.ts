import type { ProductConfig } from "@vibecheck/contracts";

export type DiscoveryProviderName = "fixture" | "devin";
export type DiscoveryContext = ProductConfig & {
  sourceRevision: string;
  sourceCandidates?: unknown[];
};
export type ProviderHandle = {
  sessionId?: string;
  url?: string;
  runId?: string;
  sourceRevision?: string;
};
export type ProviderResult = { raw: unknown; handle: ProviderHandle };

/** A discovery agent: read-only inspection that returns structured proposals or an explicit outcome. */
export interface DiscoveryProvider {
  name: string;
  propose(
    ctx: DiscoveryContext,
    run: { id: string },
    onSession?: (h: ProviderHandle) => Promise<void>,
  ): Promise<ProviderResult>;
  requestCorrection(handle: ProviderHandle, problems: string): Promise<ProviderResult>;
}
