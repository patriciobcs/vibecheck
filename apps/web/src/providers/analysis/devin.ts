import { AnalysisOutputJsonSchema } from "@vibecheck/contracts";
import type { env } from "@/lib/env";
import { buildAnalysisPrompt } from "./prompt";
import type { AnalysisProvider, ProviderHandle, ProviderResult } from "./types";

async function poll(
  cfg: NonNullable<ReturnType<typeof env>["devin"]>,
  handle: ProviderHandle,
  fetchImpl: typeof fetch,
): Promise<ProviderResult> {
  if (!handle.sessionId) return { raw: null, handle };
  const deadline = Date.now() + cfg.timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    const res = await fetchImpl(`${cfg.baseUrl}/sessions/${handle.sessionId}`, {
      headers: { authorization: `Bearer ${cfg.apiKey}` },
    });
    if (!res.ok) throw new Error(`devin_api_${res.status}`);
    const body = (await res.json()) as {
      structured_output?: unknown;
      status_enum?: string;
      messages?: { message?: string }[];
    };
    if (body.structured_output !== undefined) return { raw: body.structured_output, handle };
    last = body.messages?.at(-1)?.message;
    if (["finished", "blocked", "expired"].includes(body.status_enum ?? ""))
      return { raw: last, handle };
    await new Promise((resolve) => setTimeout(resolve, cfg.pollMs));
  }
  return { raw: last, handle };
}

export function createDevinAnalysisProvider(
  cfg: NonNullable<ReturnType<typeof env>["devin"]>,
  fetchImpl: typeof fetch = fetch,
): AnalysisProvider {
  const headers = { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" };
  return {
    name: "devin",
    async analyse(evidence, run, onSession) {
      const res = await fetchImpl(`${cfg.baseUrl}/sessions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          prompt: buildAnalysisPrompt(evidence),
          title: `Seamless UX analysis ${run.id}`,
          tags: ["vibecheck", "analysis"],
          structured_output_schema: AnalysisOutputJsonSchema,
          max_acu_limit: cfg.maxAcu,
          idempotent: true,
        }),
      });
      if (!res.ok) throw new Error(`devin_api_${res.status}`);
      const body = (await res.json()) as { session_id?: string; url?: string };
      const handle = { sessionId: body.session_id, url: body.url };
      await onSession?.(handle);
      return poll(cfg, handle, fetchImpl);
    },
    async requestCorrection(handle, problems) {
      if (!handle.sessionId) return { raw: null, handle };
      const res = await fetchImpl(`${cfg.baseUrl}/sessions/${handle.sessionId}/message`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message: `Correct the JSON output. Problems: ${problems}` }),
      });
      if (!res.ok) throw new Error(`devin_api_${res.status}`);
      return poll(cfg, handle, fetchImpl);
    },
  };
}
