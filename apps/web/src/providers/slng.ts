import { z } from "zod";
import type { SlngConfig } from "@/lib/env";

/**
 * SLNG speech-to-text adapter (Deepgram Nova 3 via the SLNG gateway).
 * Docs: https://docs.slng.ai/api-reference/speech-to-text/slng/deepgram-nova-3/nova-3-english-http.md
 * Request: POST {SLNG_BASE_URL}{SLNG_STT_PATH} multipart with field `audio`, bearer auth.
 */

const WordSchema = z.object({
  word: z.string(),
  start: z.number(),
  end: z.number(),
  confidence: z.number().optional(),
  punctuated_word: z.string().optional(),
  speaker: z.number().optional(),
});

const UtteranceSchema = z.object({
  start: z.number(),
  end: z.number(),
  confidence: z.number().optional(),
  transcript: z.string(),
  id: z.string().optional(),
  speaker: z.number().optional(),
});

export const DeepgramResponseSchema = z.object({
  metadata: z
    .object({
      request_id: z.string().optional(),
      model: z.string().optional(),
      duration: z.number().optional(),
    })
    .passthrough(),
  results: z.object({
    channels: z.array(
      z.object({
        alternatives: z.array(
          z.object({
            transcript: z.string(),
            confidence: z.number().optional(),
            words: z.array(WordSchema).optional(),
          }),
        ),
      }),
    ),
    utterances: z.array(UtteranceSchema).optional(),
  }),
});

export type DeepgramResponse = z.infer<typeof DeepgramResponseSchema>;

export type MappedSegment = {
  start_ms: number;
  end_ms: number;
  text: string;
  confidence: number | null;
  speaker: "participant";
};

const toMs = (seconds: number) => Math.round(seconds * 1000);

/** Convert provider timestamps (seconds, relative to the audio file) into session milliseconds. */
export function mapDeepgramResponse(
  raw: unknown,
  opts: { offsetMs: number; maxGapMs?: number },
): MappedSegment[] {
  const res = DeepgramResponseSchema.parse(raw);
  const maxGapMs = opts.maxGapMs ?? 800;

  if (res.results.utterances && res.results.utterances.length > 0) {
    return res.results.utterances
      .filter((u) => u.transcript.trim() !== "")
      .map((u) => ({
        start_ms: opts.offsetMs + toMs(u.start),
        end_ms: opts.offsetMs + toMs(u.end),
        text: u.transcript.trim(),
        confidence: u.confidence ?? null,
        speaker: "participant" as const,
      }));
  }

  const words = res.results.channels[0]?.alternatives[0]?.words ?? [];
  const segments: MappedSegment[] = [];
  let current: { start: number; end: number; words: string[]; conf: number[] } | null = null;
  for (const w of words) {
    const text = w.punctuated_word ?? w.word;
    if (current && toMs(w.start) - toMs(current.end) <= maxGapMs) {
      current.end = w.end;
      current.words.push(text);
      if (w.confidence !== undefined) current.conf.push(w.confidence);
    } else {
      if (current) segments.push(finish(current, opts.offsetMs));
      current = {
        start: w.start,
        end: w.end,
        words: [text],
        conf: w.confidence !== undefined ? [w.confidence] : [],
      };
    }
  }
  if (current) segments.push(finish(current, opts.offsetMs));
  return segments;
}

function finish(
  c: { start: number; end: number; words: string[]; conf: number[] },
  offsetMs: number,
): MappedSegment {
  const confidence = c.conf.length
    ? Math.round((c.conf.reduce((a, b) => a + b, 0) / c.conf.length) * 1000) / 1000
    : null;
  return {
    start_ms: offsetMs + toMs(c.start),
    end_ms: offsetMs + toMs(c.end),
    text: c.words.join(" "),
    confidence,
    speaker: "participant",
  };
}

export type SttClient = {
  transcribe(input: {
    audio: Blob;
    filename: string;
  }): Promise<{ raw: unknown; requestId: string | null }>;
};

export class SlngError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}

/** Real SLNG client. Sends the audio file and the Deepgram options that give us timestamps. */
export function createSlngClient(config: SlngConfig, fetchImpl: typeof fetch = fetch): SttClient {
  return {
    async transcribe({ audio, filename }) {
      // Options go in the query string (Deepgram convention). Sending them as multipart fields
      // makes the gateway resolve a non-existent model ("latest") and answer 400 (observed 2026-09-19).
      const url = new URL(config.sttUrl);
      url.searchParams.set("language", config.language);
      url.searchParams.set("punctuate", "true");
      url.searchParams.set("utterances", "true");
      url.searchParams.set("smart_format", "true");
      const form = new FormData();
      form.append("audio", audio, filename);
      const res = await fetchImpl(url.toString(), {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}` },
        body: form,
      });
      const text = await res.text();
      if (!res.ok)
        throw new SlngError(
          `SLNG transcription failed (${res.status}): ${text.slice(0, 300)}`,
          res.status,
          text.slice(0, 2000),
        );
      const raw = JSON.parse(text) as unknown;
      const parsed = DeepgramResponseSchema.safeParse(raw);
      return { raw, requestId: parsed.success ? (parsed.data.metadata.request_id ?? null) : null };
    },
  };
}
