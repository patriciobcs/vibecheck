import { agentOutputJsonSchema } from "@vibecheck/contracts";
import { buildDiscoveryPrompt } from "./devin-prompt";
import type { DiscoveryProvider, ProviderHandle, ProviderResult } from "./types";

export type DevinConfig = {
  apiKey: string;
  baseUrl: string;
  pollMs: number;
  timeoutMs: number;
  maxAcu: number;
};

/**
 * Devin adapter: one session per discovery run with a structured-output schema; polled until the
 * structured output appears or the session reaches a terminal status. The worker owns the polling.
 */
export function createDevinDiscoveryProvider(
  cfg: DevinConfig,
  fetchImpl: typeof fetch = fetch,
): DiscoveryProvider {
  const headers = { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" };

  async function poll(handle: ProviderHandle): Promise<ProviderResult> {
    if (!handle.sessionId) return { raw: null, handle };
    const deadline = Date.now() + cfg.timeoutMs;
    let last: unknown;
    while (Date.now() < deadline) {
      const res = await fetchImpl(`${cfg.baseUrl}/sessions/${handle.sessionId}`, { headers });
      if (!res.ok) throw new Error(`devin_api_${res.status}`);
      const body = (await res.json()) as {
        structured_output?: unknown;
        status_enum?: string;
        messages?: { message?: string }[];
      };
      if (body.structured_output != null) return { raw: body.structured_output, handle };
      last = body.messages?.at(-1)?.message;
      if (["finished", "blocked", "expired"].includes(body.status_enum ?? ""))
        return { raw: last, handle };
      await new Promise((r) => setTimeout(r, cfg.pollMs));
    }
    return { raw: last, handle };
  }

  return {
    name: "devin",
    async propose(context, run, onSession) {
      const res = await fetchImpl(`${cfg.baseUrl}/sessions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          prompt: buildDiscoveryPrompt(context, run.id),
          title: `VibeCheck discovery ${run.id}`,
          tags: ["vibecheck", "discovery"],
          unlisted: true,
          structured_output_schema: agentOutputJsonSchema,
          max_acu_limit: cfg.maxAcu,
          idempotent: true,
        }),
      });
      if (!res.ok) throw new Error(`devin_api_${res.status}`);
      const body = (await res.json()) as { session_id?: string; url?: string };
      const handle = { sessionId: body.session_id, url: body.url };
      await onSession?.(handle);
      return poll(handle);
    },
    async requestCorrection(handle, problems) {
      if (!handle.sessionId) return { raw: null, handle };
      const res = await fetchImpl(`${cfg.baseUrl}/sessions/${handle.sessionId}/message`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message: `Correct the JSON output. Problems: ${problems}` }),
      });
      if (!res.ok) throw new Error(`devin_api_${res.status}`);
      return poll(handle);
    },
  };
}
