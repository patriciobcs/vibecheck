import { z } from "zod";

export const productConfigSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  url: z.string().url(),
  permitted_origins: z.array(z.string().url()).default([]),
  language: z.string().default("en"),
  audience: z.string().default(""),
  repo_binding: z.record(z.unknown()).optional(),
  release_notes: z.array(z.object({
    id: z.string(),
    text: z.string(),
    source: z.string(),
    isSample: z.boolean(),
  })).default([]),
  support_complaints: z.array(z.object({
    id: z.string(),
    text: z.string(),
    source: z.string(),
    isSample: z.boolean(),
  })).default([]),
  known_journeys: z.array(z.string()).default([]),
  product_events: z.array(z.unknown()).default([]),
});

export type ProductConfig = z.infer<typeof productConfigSchema>;
