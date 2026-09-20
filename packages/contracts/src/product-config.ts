import { z } from "zod";
import { RepoBindingSchema } from "./repo-binding";

const SourceItemSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  source: z.string(),
  isSample: z.boolean(),
});

/** Owner-supplied product configuration (VC-01). Imported material carries provenance and a sample flag. */
export const ProductConfigSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  url: z.url(),
  permitted_origins: z.array(z.url()).default([]),
  language: z.string().default("en"),
  audience: z.string().default(""),
  repo_binding: RepoBindingSchema.optional(),
  release_notes: z.array(SourceItemSchema).default([]),
  support_complaints: z.array(SourceItemSchema).default([]),
  known_journeys: z.array(z.string()).default([]),
  product_events: z.array(z.unknown()).default([]),
});

export type ProductConfig = z.infer<typeof ProductConfigSchema>;
export type SourceItem = z.infer<typeof SourceItemSchema>;
