import fixture from "@/fixtures/discovery-excalidraw.json";
import type { DiscoveryProvider } from "./types";

/** Deterministic, sample-labeled proposals for local development and tests. Never agent inference. */
export const fixtureDiscoveryProvider: DiscoveryProvider = {
  name: "fixture",
  async propose(ctx, run) {
    return {
      raw: { ...fixture, discovery_run_id: run.id, source_revision: ctx.sourceRevision },
      handle: { runId: run.id, sourceRevision: ctx.sourceRevision },
    };
  },
  async requestCorrection(handle) {
    return {
      raw: { ...fixture, discovery_run_id: handle.runId, source_revision: handle.sourceRevision },
      handle,
    };
  },
};
