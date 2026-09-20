import { type GithubRepoBinding, type RepoBinding, RepoBindingSchema } from "@vibecheck/contracts";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { ApiError } from "@/lib/api";
import { env } from "@/lib/env";
import { hasGithubCredentials } from "@/providers/github/auth";
import { githubIssuePublisher } from "@/providers/github/github";
import { memoryIssuePublisher } from "@/providers/github/memory";
import type { RepoPublisher } from "@/providers/github/types";

export type RepoBindingCheck =
  | {
      ok: true;
      binding: GithubRepoBinding;
    }
  | {
      ok: false;
      reason: "repo_not_found" | "base_sha_missing" | "github_unconfigured";
    };

export function defaultPublisher(): RepoPublisher {
  return env().ISSUE_PUBLISHER === "memory" ? memoryIssuePublisher : githubIssuePublisher;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isGithubUnconfigured(error: unknown) {
  const message = errorText(error);
  return message === "no_token" || message.startsWith("github_app_auth_");
}

function isNotFound(error: unknown) {
  return errorText(error).includes("404");
}

export async function resolveGithubBinding(
  input: {
    owner: string;
    repo: string;
    baseline_commit_sha?: string;
    issues_enabled?: boolean;
  },
  publisher: RepoPublisher = defaultPublisher(),
): Promise<RepoBindingCheck> {
  const repo = { owner: input.owner, repo: input.repo };
  let defaultBranch: string;
  try {
    if (publisher === githubIssuePublisher && !hasGithubCredentials())
      return { ok: false, reason: "github_unconfigured" };
    defaultBranch = await publisher.getDefaultBranch(repo);
  } catch (error) {
    if (isGithubUnconfigured(error)) return { ok: false, reason: "github_unconfigured" };
    return { ok: false, reason: "repo_not_found" };
  }

  const baseline = input.baseline_commit_sha?.trim();
  let baselineSha = baseline;
  if (baseline) {
    try {
      const exists = publisher.getCommit ? await publisher.getCommit(repo, baseline) : false;
      if (!exists) return { ok: false, reason: "base_sha_missing" };
    } catch (error) {
      if (isGithubUnconfigured(error)) return { ok: false, reason: "github_unconfigured" };
      if (isNotFound(error)) return { ok: false, reason: "base_sha_missing" };
      return { ok: false, reason: "repo_not_found" };
    }
  } else {
    try {
      const branchSha = await publisher.getBranchSha(repo, defaultBranch);
      if (!branchSha) return { ok: false, reason: "repo_not_found" };
      baselineSha = branchSha;
    } catch (error) {
      if (isGithubUnconfigured(error)) return { ok: false, reason: "github_unconfigured" };
      return { ok: false, reason: "repo_not_found" };
    }
  }

  return {
    ok: true,
    binding: {
      provider: "github",
      owner: input.owner,
      repo: input.repo,
      default_branch: defaultBranch,
      baseline_commit_sha: baselineSha,
      issues_enabled: input.issues_enabled ?? true,
    },
  };
}

const REPO_ERROR_MESSAGES = {
  repo_not_found: "Repository not found or the seamlessuxbot GitHub App isn't installed on it.",
  base_sha_missing: "That commit doesn't exist in the repository.",
  github_unconfigured: "GitHub App credentials aren't configured on this server.",
} as const;

export async function setProductRepoBinding(
  tenantIds: string[],
  productId: string,
  input: unknown,
  publisher?: RepoPublisher,
) {
  const binding = RepoBindingSchema.parse(input);
  const product = await db.query.products.findFirst({
    where: and(eq(schema.products.id, productId), inArray(schema.products.tenantId, tenantIds)),
  });
  if (!product) throw new ApiError(404, "not_found", "Product not found.");

  let stored: RepoBinding = binding;
  if (binding.provider === "github") {
    const result = await resolveGithubBinding(binding, publisher);
    if (!result.ok) throw new ApiError(422, result.reason, REPO_ERROR_MESSAGES[result.reason]);
    stored = result.binding;
  }
  const [updated] = await db
    .update(schema.products)
    .set({ repoBinding: stored, status: "ready", setupError: null })
    .where(and(eq(schema.products.id, productId), inArray(schema.products.tenantId, tenantIds)))
    .returning();
  if (!updated) throw new ApiError(404, "not_found", "Product not found.");
  return stored;
}

export function repoBindingErrorMessage(
  reason: "repo_not_found" | "base_sha_missing" | "github_unconfigured",
) {
  return REPO_ERROR_MESSAGES[reason];
}
