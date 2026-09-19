import { z } from "zod";
import type { ProductConfig } from "@/contracts/productConfig";

export const discoveryProviderSchema = z.enum(["fixture", "devin"]);
export type DiscoveryProviderName = z.infer<typeof discoveryProviderSchema>;

export type DiscoveryContext = ProductConfig & { sourceRevision: string };

export type ProviderHandle = {
  sessionId?: string;
  url?: string;
  runId?: string;
  sourceRevision?: string;
};
export type ProviderResult = { raw: unknown; handle: ProviderHandle };
export interface DiscoveryProvider {
  name: string;
  propose(
    ctx: DiscoveryContext,
    run: { id: string },
    onSession?: (handle: ProviderHandle) => Promise<void>,
  ): Promise<ProviderResult>;
  requestCorrection(handle: ProviderHandle, problems: string): Promise<ProviderResult>;
}
