import { describe, expect, it } from "vitest";
import { mapDeepgramResponse } from "./slng";

const response = {
  metadata: { request_id: "req_1", model: "nova-3", duration: 4.2 },
  results: {
    channels: [
      {
        alternatives: [
          {
            transcript: "okay where is reschedule",
            confidence: 0.97,
            words: [
              { word: "okay", start: 0.1, end: 0.4, confidence: 0.99, punctuated_word: "Okay," },
              { word: "where", start: 1.2, end: 1.5, confidence: 0.95 },
              { word: "is", start: 1.5, end: 1.6, confidence: 0.9 },
              { word: "reschedule", start: 1.7, end: 2.4, confidence: 0.8 },
            ],
          },
        ],
      },
    ],
    utterances: [
      { start: 0.1, end: 0.4, confidence: 0.99, transcript: "Okay,", id: "u1" },
      { start: 1.2, end: 2.4, confidence: 0.88, transcript: "where is reschedule", id: "u2" },
    ],
  },
};

describe("mapDeepgramResponse", () => {
  it("maps utterances to transcript segments in session milliseconds with the asset offset", () => {
    const segments = mapDeepgramResponse(response, { offsetMs: 30_000 });
    expect(segments).toEqual([
      { start_ms: 30_100, end_ms: 30_400, text: "Okay,", confidence: 0.99, speaker: "participant" },
      {
        start_ms: 31_200,
        end_ms: 32_400,
        text: "where is reschedule",
        confidence: 0.88,
        speaker: "participant",
      },
    ]);
  });

  it("falls back to word groups when utterances are absent", () => {
    const noUtterances = { ...response, results: { channels: response.results.channels } };
    const segments = mapDeepgramResponse(noUtterances, { offsetMs: 0, maxGapMs: 500 });
    expect(segments.map((s) => s.text)).toEqual(["Okay,", "where is reschedule"]);
    expect(segments[1]).toMatchObject({ start_ms: 1200, end_ms: 2400 });
  });

  it("returns no segments for an empty transcript", () => {
    const empty = {
      metadata: response.metadata,
      results: { channels: [{ alternatives: [{ transcript: "", confidence: 0, words: [] }] }] },
    };
    expect(mapDeepgramResponse(empty, { offsetMs: 0 })).toEqual([]);
  });
});
