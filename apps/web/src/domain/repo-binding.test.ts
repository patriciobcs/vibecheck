import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/db/client";
import { MemoryIssuePublisher, memoryIssuePublisher } from "@/providers/github/memory";
import { resetDb } from "@/test/db";
import { seedStudy } from "@/test/fixtures";
import { resolveGithubBinding, setProductRepoBinding } from "./repo-binding";

beforeEach(resetDb);

describe("resolveGithubBinding", () => {
  it("resolves a repository using the memory publisher", async () => {
    const result = await resolveGithubBinding(
      { owner: "owner", repo: "repo" },
      memoryIssuePublisher,
    );
    expect(result).toEqual({
      ok: true,
      binding: {
        provider: "github",
        owner: "owner",
        repo: "repo",
        default_branch: "master",
        baseline_commit_sha: "candidate-sha",
        issues_enabled: true,
      },
    });
  });

  it("rejects an unknown explicit commit", async () => {
    const result = await resolveGithubBinding(
      { owner: "owner", repo: "repo", baseline_commit_sha: "missing" },
      new MemoryIssuePublisher({ commits: ["known"] }),
    );
    expect(result).toEqual({ ok: false, reason: "base_sha_missing" });
  });

  it("maps a default-branch lookup failure to repo_not_found", async () => {
    const publisher = new MemoryIssuePublisher();
    publisher.getDefaultBranch = async () => {
      throw new Error("github_api_404");
    };
    const result = await resolveGithubBinding({ owner: "owner", repo: "repo" }, publisher);
    expect(result).toEqual({ ok: false, reason: "repo_not_found" });
  });
});

describe("setProductRepoBinding", () => {
  it("persists a resolved binding", async () => {
    const { tenantId, productId } = await seedStudy();
    const stored = await setProductRepoBinding(
      [tenantId],
      productId,
      { provider: "github", owner: "owner", repo: "repo" },
      new MemoryIssuePublisher({ defaultBranch: "main", branchSha: "base-sha" }),
    );
    expect(stored).toMatchObject({
      provider: "github",
      default_branch: "main",
      baseline_commit_sha: "base-sha",
    });
    expect((await db.query.products.findFirst())?.repoBinding).toMatchObject(stored);
  });

  it("clears needs_setup after a successful binding update", async () => {
    const { tenantId, productId } = await seedStudy();
    await db
      .update(schema.products)
      .set({ status: "needs_setup", setupError: "connect repository" })
      .where(eq(schema.products.id, productId));
    await setProductRepoBinding([tenantId], productId, { provider: "local", path: "/tmp/repo" });
    expect(await db.query.products.findFirst()).toMatchObject({
      status: "ready",
      setupError: null,
      repoBinding: { provider: "local", path: "/tmp/repo" },
    });
  });
});
