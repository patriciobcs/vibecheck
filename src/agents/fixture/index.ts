import fixture from "../../../fixtures/discovery/excalidraw.json";
import type { DiscoveryContext, DiscoveryProvider, ProviderHandle, ProviderResult } from "../types";

export const fixtureProvider: DiscoveryProvider = {
  name: "fixture",
  async propose(_ctx: DiscoveryContext, _run): Promise<ProviderResult> {
    return { raw: fixture, handle: {} };
  },
  async requestCorrection(_handle: ProviderHandle, _problems: string): Promise<ProviderResult> {
    return { raw: fixture, handle: {} };
  },
};
