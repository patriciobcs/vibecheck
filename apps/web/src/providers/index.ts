import { env } from "@/lib/env";
import { createJevClient, type JevClient } from "./jev";
import { createSlngClient, type SttClient } from "./slng";
import { createVonageClient, type MediaClient } from "./vonage";

/** Provider factories. A missing key yields null; callers must surface that, never fake it. */
export function mediaClient(): MediaClient | null {
  const cfg = env().vonage;
  return cfg ? createVonageClient(cfg) : null;
}

export function sttClient(): SttClient | null {
  const cfg = env().slng;
  return cfg ? createSlngClient(cfg) : null;
}

export function jevClient(): JevClient | null {
  const cfg = env().jev;
  return cfg
    ? createJevClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: cfg.model })
    : null;
}

export function providerStatus() {
  return {
    vonage: env().vonage !== null,
    slng: env().slng !== null,
    vonageCallbackSecret: env().vonage?.archiveSignatureSecret != null,
    devin: env().devin !== null,
    jev: env().jev !== null,
    jevPriced: env().jev?.priceMicrosPer1k != null,
  };
}
