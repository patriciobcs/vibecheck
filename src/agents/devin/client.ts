import type { ProviderHandle, ProviderResult } from "../types";

const base = process.env.DEVIN_API_BASE ?? "https://api.devin.ai/v1";
const headers = () => ({
  authorization: `Bearer ${process.env.DEVIN_API_KEY ?? ""}`,
  "content-type": "application/json",
});
const pollMs = () => Number(process.env.DEVIN_POLL_MS ?? 10000);

export async function createDevinSession(input: {
  prompt: string;
  title: string;
  tags: string[];
  structuredOutputSchema: unknown;
}): Promise<ProviderHandle> {
  const response = await fetch(`${base}/sessions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      prompt: input.prompt,
      title: input.title,
      tags: input.tags,
      unlisted: true,
      structured_output_schema: input.structuredOutputSchema,
      max_acu_limit: Number(process.env.DEVIN_MAX_ACU ?? 5),
      idempotent: true,
    }),
  });
  if (!response.ok) throw new Error(`devin_api_${response.status}`);
  const body = (await response.json()) as { session_id?: string; url?: string };
  return { sessionId: body.session_id, url: body.url };
}

export async function pollDevinSession(handle: ProviderHandle): Promise<ProviderResult> {
  if (!handle.sessionId) return { raw: null, handle };
  const deadline = Date.now() + Number(process.env.DEVIN_TIMEOUT_MS ?? 1200000);
  let last: unknown;
  while (Date.now() < deadline) {
    const response = await fetch(`${base}/sessions/${handle.sessionId}`, { headers: headers() });
    if (!response.ok) throw new Error(`devin_api_${response.status}`);
    const body = (await response.json()) as {
      structured_output?: unknown;
      status_enum?: string;
      messages?: Array<{ message?: string }>;
    };
    if (body.structured_output != null) return { raw: body.structured_output, handle };
    last = body.messages?.at(-1)?.message;
    if (["finished", "blocked", "expired"].includes(body.status_enum ?? ""))
      return { raw: last, handle };
    await new Promise((resolve) => setTimeout(resolve, pollMs()));
  }
  return { raw: last, handle };
}

export async function messageDevinSession(
  handle: ProviderHandle,
  message: string,
): Promise<ProviderResult> {
  if (!handle.sessionId) return { raw: null, handle };
  const response = await fetch(`${base}/sessions/${handle.sessionId}/message`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ message }),
  });
  if (!response.ok) throw new Error(`devin_api_${response.status}`);
  return pollDevinSession(handle);
}
