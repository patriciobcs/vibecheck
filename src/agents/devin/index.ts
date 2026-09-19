import { agentOutputJsonSchema } from "@/contracts/agentOutput";
import type { DiscoveryContext, DiscoveryProvider, ProviderHandle, ProviderResult } from "../types";
import { buildPrompt } from "./prompt";

const base = process.env.DEVIN_API_BASE ?? "https://api.devin.ai/v1";
const headers = () => ({ authorization: `Bearer ${process.env.DEVIN_API_KEY ?? ""}`, "content-type": "application/json" });
const pollMs = () => Number(process.env.DEVIN_POLL_MS ?? 10000);

async function poll(handle: ProviderHandle): Promise<ProviderResult> {
  if (!handle.sessionId) return { raw: null, handle };
  const deadline = Date.now() + Number(process.env.DEVIN_TIMEOUT_MS ?? 1200000);
  let last: unknown;
  while (Date.now() < deadline) {
    const response = await fetch(`${base}/sessions/${handle.sessionId}`, { headers: headers() });
    const body = await response.json() as { structured_output?: unknown; status_enum?: string; messages?: Array<{ text?: string }> };
    if (body.structured_output != null) return { raw: body.structured_output, handle };
    last = body.messages?.at(-1)?.text;
    if (["finished", "blocked", "expired"].includes(body.status_enum ?? "")) return { raw: last, handle };
    await new Promise((resolve) => setTimeout(resolve, pollMs()));
  }
  return { raw: last, handle };
}

export const devinProvider: DiscoveryProvider = {
  name: "devin",
  async propose(context, run) {
    const response = await fetch(`${base}/sessions`, {
      method: "POST", headers: headers(),
      body: JSON.stringify({ prompt: buildPrompt(context, run.id), title: `VibeCheck discovery ${run.id}`, tags: ["vibecheck", "discovery"], unlisted: true, structured_output_schema: agentOutputJsonSchema, max_acu_limit: Number(process.env.DEVIN_MAX_ACU ?? 5), idempotent: true }),
    });
    const body = await response.json() as { session_id?: string; url?: string };
    return poll({ sessionId: body.session_id, url: body.url });
  },
  async requestCorrection(handle, problems) {
    if (!handle.sessionId) return { raw: null, handle };
    const response = await fetch(`${base}/sessions/${handle.sessionId}/message`, { method: "POST", headers: headers(), body: JSON.stringify({ message: `Correct the JSON output. Problems: ${problems}` }) });
    if (!response.ok) {
      return this.propose({ url: "", description: `Correction required: ${problems}`, audience: "", language: "en", releaseNotes: [], complaints: [], journeys: [], events: [] }, { id: handle.sessionId });
    }
    return poll(handle);
  },
};
