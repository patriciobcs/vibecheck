export type DiscoveryContext = {
  url: string;
  description: string;
  audience: string;
  language: string;
  releaseNotes: unknown;
  complaints: unknown;
  journeys: unknown;
  events: unknown;
};

export type ProviderHandle = { sessionId?: string; url?: string };
export type ProviderResult = { raw: unknown; handle: ProviderHandle };
export interface DiscoveryProvider {
  name: string;
  propose(ctx: DiscoveryContext, run: { id: string }): Promise<ProviderResult>;
  requestCorrection(handle: ProviderHandle, problems: string): Promise<ProviderResult>;
}
