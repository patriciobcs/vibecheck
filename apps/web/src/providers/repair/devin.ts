import { repairOutputJsonSchema } from "@vibecheck/contracts";
import type { env } from "@/lib/env";
import type { ProviderHandle, ProviderResult } from "@/providers/analysis/types";
import { buildRepairPrompt } from "./prompt";
import type { RepairProvider } from "./types";

type DevinConfig = NonNullable<ReturnType<typeof env>["devin"]>;

async function poll(cfg: DevinConfig, handle: ProviderHandle): Promise<ProviderResult> {
  if (!handle.sessionId) return { raw: null, handle };
  const deadline = Date.now() + cfg.timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    const response = await fetch(`${cfg.baseUrl}/sessions/${handle.sessionId}`, {
      headers: { authorization: `Bearer ${cfg.apiKey}` },
    });
    if (!response.ok) throw new Error(`devin_api_${response.status}`);
    const body = (await response.json()) as {
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

export function createDevinRepairProvider(cfg: DevinConfig): RepairProvider {
  return {
    name: "devin",
    async start(context, onSession) {
      const response = await fetch(`${cfg.baseUrl}/sessions`, {
        method: "POST",
        headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          prompt: buildRepairPrompt(context),
          title: `VibeCheck repair ${context.repairRunId}`,
          tags: ["vibecheck", "repair"],
          structured_output_schema: repairOutputJsonSchema,
          max_acu_limit: cfg.maxAcu,
          idempotent: true,
        }),
      });
      if (!response.ok) throw new Error(`devin_api_${response.status}`);
      const body = (await response.json()) as { session_id?: string; url?: string };
      const handle = { sessionId: body.session_id, url: body.url };
      await onSession?.(handle);
      return poll(cfg, handle);
    },
    async revise(handle, diagnostics) {
      if (!handle.sessionId) return { raw: null, handle };
      const response = await fetch(`${cfg.baseUrl}/sessions/${handle.sessionId}/message`, {
        method: "POST",
        headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          message: `Correct the candidate and return only the repair JSON. Diagnostics: ${diagnostics}`,
        }),
      });
      if (!response.ok) throw new Error(`devin_api_${response.status}`);
      return poll(cfg, handle);
    },
  };
}
