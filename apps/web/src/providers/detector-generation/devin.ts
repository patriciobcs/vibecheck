import { generatedDetectorJsonSchema } from "@vibecheck/contracts";
import type { DevinConfig } from "@/lib/env";
import type {
  DetectorGenerationContext,
  DetectorGenerator,
  GenerationHandle,
  GenerationResult,
} from "./types";

export function buildDetectorPrompt(ctx: DetectorGenerationContext): string {
  return `You are authoring a continuous UX detector for VibeCheck. Read only authorized product context; do not modify anything.
Journey to cover: ${ctx.journeyHint}. App build: ${ctx.appBuildRef}.
Map the journey to observable progress, success, failures and help requests using ONLY these semantic event types:
journey_start, progress, action_attempt, action_result, validation_error, navigation, help_request, completion, exit, visibility.
Instrumentation the product already emits: ${ctx.observedEventTypes.join(", ") || "none observed yet"}.
List any required event the product does not emit in missing_instrumentation; never assume telemetry exists.

Write Jev questions (types noul, choice, score). Every instruction must stand alone and must not reference
another question or answer. Include exactly these keys: evidence_sufficiency (choice: sufficient/partial/insufficient),
ux_friction_observed (noul), targeted_research_warranted (noul), problem_category (choice, must include other_or_uncertain).
Silence, slow reading and inactive tabs do not establish frustration or dishonesty. Known goals must come from declared
journeys; inferred intentions must be labeled. Return only this JSON shape:
${JSON.stringify(generatedDetectorJsonSchema)}

Product context:
${JSON.stringify({ product: ctx.product, known_journeys: ctx.knownJourneys }, null, 2)}`;
}

/** Devin adapter for detector authoring: one session, structured output, polled by the worker. */
export function createDevinDetectorGenerator(
  cfg: DevinConfig,
  fetchImpl: typeof fetch = fetch,
): DetectorGenerator {
  const headers = { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" };
  async function poll(handle: GenerationHandle): Promise<GenerationResult> {
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
    async generate(ctx, onSession) {
      const res = await fetchImpl(`${cfg.baseUrl}/sessions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          prompt: buildDetectorPrompt(ctx),
          title: `VibeCheck detector ${ctx.journeyHint} ${ctx.appBuildRef}`,
          tags: ["vibecheck", "detector"],
          unlisted: true,
          structured_output_schema: generatedDetectorJsonSchema,
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
  };
}
