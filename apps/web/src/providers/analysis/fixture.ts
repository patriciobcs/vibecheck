import fixture from "@/fixtures/analysis/sample_session_capture_ideas.json";
import type { AnalysisProvider } from "./types";

export const fixtureAnalysisProvider: AnalysisProvider = {
  name: "fixture",
  async analyse(evidence) {
    return {
      raw: {
        ...fixture,
        evidence_package_id: evidence.evidence_package_id,
        session_id: evidence.session_id,
      },
      handle: {},
    };
  },
  async requestCorrection(handle, _problems) {
    return { raw: fixture, handle };
  },
};
