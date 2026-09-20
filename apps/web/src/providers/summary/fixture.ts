import type { SummaryProvider } from "./types";

export const fixtureSummaryProvider: SummaryProvider = {
  name: "fixture",
  async summarize(input) {
    const first = input.themes[0];
    const findingIds = first ? [first.finding_id] : [];
    return {
      raw: {
        schema_version: "1.0",
        study_id: input.study_id,
        headline: first
          ? `${first.title} was observed across sessions`
          : "Study evidence is available",
        observations: [
          {
            text: first
              ? first.observation
              : "The available sessions produced no recurring finding.",
            finding_ids: findingIds,
          },
          {
            text: first ? first.hypothesis : "More sessions are needed to identify a clear theme.",
            finding_ids: findingIds,
          },
          {
            text: `${input.sessions.eligible} eligible session${input.sessions.eligible === 1 ? "" : "s"} contributed to this summary.`,
            finding_ids: findingIds,
          },
        ],
        limitations: ["Fixture narrative; not human evidence."],
      },
      handle: {},
    };
  },
  async requestCorrection(handle) {
    return { raw: null, handle };
  },
};
