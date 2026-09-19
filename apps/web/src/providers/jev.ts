import { type JevQuestions, JevRequestSchema, JevResponseSchema } from "@vibecheck/contracts";

export type JevConfig = { apiKey: string; baseUrl: string; model: string };

export class JevProviderError extends Error {
  constructor(
    readonly code: string,
    readonly status: number | null,
    readonly transient: boolean,
    readonly body: string,
  ) {
    super(`jev ${code}${status ? ` (${status})` : ""}`);
  }
}

export type JevResult = {
  model: string;
  answers: Record<string, unknown>;
  usage: { input_tokens: number; output_tokens: number } | null;
  requestId: string | null;
};

export type JevClient = {
  evaluate(input: { state: unknown; questions: JevQuestions }): Promise<JevResult>;
};

/**
 * Jev (typesafe.ai) adapter: `POST /v1/systemone` with model, state and questions
 * (docs.typesafe.ai/api, checked 2026-09-19). 429/529 are transient; everything else permanent.
 */
export function createJevClient(cfg: JevConfig, fetchImpl: typeof fetch = fetch): JevClient {
  return {
    async evaluate({ state, questions }) {
      const request = JevRequestSchema.parse({ model: cfg.model, state, questions });
      const res = await fetchImpl(`${cfg.baseUrl.replace(/\/$/, "")}/v1/systemone`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const text = await res.text();
      const requestId = res.headers.get("x-request-id");
      if (!res.ok) {
        const transient = res.status === 429 || res.status === 529 || res.status >= 500;
        throw new JevProviderError(
          `http_${res.status}`,
          res.status,
          transient,
          text.slice(0, 2000),
        );
      }
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        throw new JevProviderError("malformed_response", res.status, false, text.slice(0, 2000));
      }
      const parsed = JevResponseSchema.safeParse(raw);
      if (!parsed.success)
        throw new JevProviderError("malformed_response", res.status, false, text.slice(0, 2000));
      return {
        model: parsed.data.model,
        answers: parsed.data.answers,
        usage: parsed.data.usage ?? null,
        requestId: parsed.data.request_id ?? requestId,
      };
    },
  };
}
