import fixture from "../../../fixtures/discovery/excalidraw.json";
import type { DiscoveryContext, DiscoveryProvider, ProviderHandle, ProviderResult } from "../types";

export const fixtureProvider: DiscoveryProvider = {
  name: "fixture",
  async propose(ctx: DiscoveryContext, _run): Promise<ProviderResult> {
    return { raw: { ...fixture, discovery_run_id: _run.id, source_revision: ctx.sourceRevision }, handle: { runId: _run.id, sourceRevision: ctx.sourceRevision } };
  },
  async requestCorrection(_handle: ProviderHandle, _problems: string): Promise<ProviderResult> {
    return { raw: { ...fixture, discovery_run_id: _handle.runId, source_revision: _handle.sourceRevision }, handle: _handle };
  },
};
