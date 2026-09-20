import type { ProductConfig } from "@vibecheck/contracts";

export type DetectorGenerationContext = {
  product: ProductConfig;
  appBuildRef: string;
  journeyHint: string;
  /** Event types this product has actually emitted so far (observed instrumentation). */
  observedEventTypes: string[];
  /** Success rules and declared journeys the generator may map to. */
  knownJourneys: string[];
};
export type GenerationHandle = { sessionId?: string; url?: string };
export type GenerationResult = { raw: unknown; handle: GenerationHandle };

/** Reads authorized code/context and returns a GeneratedDetector (validated by the service, never trusted). */
export interface DetectorGenerator {
  name: string;
  generate(
    ctx: DetectorGenerationContext,
    onSession?: (h: GenerationHandle) => Promise<void>,
  ): Promise<GenerationResult>;
}
