import fixture from "@/fixtures/discovery-excalidraw.json";
import type { DiscoveryProvider } from "./types";

/** Deterministic, sample-labeled proposals for local development and tests. Never agent inference. */
export const fixtureDiscoveryProvider: DiscoveryProvider = {
  name: "fixture",
  async propose(ctx, run) {
    // When passive-screening candidates are supplied, the fixture attributes its first proposal to
    // them so provenance can be exercised end to end. Still sample output, not inference.
    const candidateIds = (ctx.sourceCandidates ?? [])
      .map((c) => (c as { candidate_id?: string }).candidate_id)
      .filter((v): v is string => typeof v === "string");
    const proposals = fixture.proposals.map((p, i) =>
      i === 0 && candidateIds.length ? { ...p, source_candidate_refs: candidateIds } : p,
    );
    return {
      raw: { ...fixture, proposals, discovery_run_id: run.id, source_revision: ctx.sourceRevision },
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
