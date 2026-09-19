import { z } from "zod";

const githubRepoBindingSchema = z.object({
  provider: z.literal("github"),
  owner: z.string().regex(/^[\w.-]+$/),
  repo: z.string().regex(/^[\w.-]+$/),
  issues_enabled: z.boolean().default(true),
});

const localRepoBindingSchema = z.object({
  provider: z.literal("local"),
  path: z.string().min(1),
});

export const repoBindingSchema = z.discriminatedUnion("provider", [
  githubRepoBindingSchema,
  localRepoBindingSchema,
]);

export type GithubRepoBinding = z.infer<typeof githubRepoBindingSchema>;
export type RepoBinding = z.infer<typeof repoBindingSchema>;
