import { z } from "zod";

export const repoBindingSchema = z.object({
  provider: z.literal("github"),
  owner: z.string().regex(/^[\w.-]+$/),
  repo: z.string().regex(/^[\w.-]+$/),
  issues_enabled: z.boolean().default(true),
});

export type RepoBinding = z.infer<typeof repoBindingSchema>;
