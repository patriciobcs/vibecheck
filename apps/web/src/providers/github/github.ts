import { getGithubToken } from "./auth";
import type { RepoPublisher } from "./types";

const apiBase = "https://api.github.com";
async function headers(repo: { owner: string; repo: string }) {
  const token = await getGithubToken(repo);
  if (!token) throw new Error("no_token");
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-github-api-version": "2022-11-28",
  };
}

export const githubIssuePublisher: RepoPublisher = {
  async findByMarker(repo, marker) {
    const requestHeaders = await headers(repo);
    const query = encodeURIComponent(`repo:${repo.owner}/${repo.repo} "${marker}" in:body`);
    const response = await fetch(`${apiBase}/search/issues?q=${query}`, {
      headers: requestHeaders,
    });
    if (response.ok) {
      const body = (await response.json()) as {
        items?: {
          number: number;
          html_url: string;
          state: "open" | "closed";
          body: string | null;
        }[];
      };
      const item = body.items?.[0];
      return item
        ? { number: item.number, url: item.html_url, state: item.state, body: item.body ?? "" }
        : null;
    }
    if (response.status !== 403 && response.status !== 422)
      throw new Error(`github_api_${response.status}`);
    for (let page = 1; page <= 5; page += 1) {
      const fallback = await fetch(
        `${apiBase}/repos/${repo.owner}/${repo.repo}/issues?state=all&per_page=100&page=${page}`,
        { headers: requestHeaders },
      );
      if (!fallback.ok) throw new Error(`github_api_${fallback.status}`);
      const items = (await fallback.json()) as {
        number: number;
        html_url: string;
        state: "open" | "closed";
        body: string | null;
      }[];
      const item = items.find((candidate) => candidate.body?.includes(marker));
      if (item)
        return {
          number: item.number,
          url: item.html_url,
          state: item.state,
          body: item.body ?? "",
        };
      if (items.length < 100) return null;
    }
    return null;
  },
  async create(repo, input) {
    const response = await fetch(`${apiBase}/repos/${repo.owner}/${repo.repo}/issues`, {
      method: "POST",
      headers: await headers(repo),
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(`github_api_${response.status}`);
    const body = (await response.json()) as { number: number; html_url: string };
    return { number: body.number, url: body.html_url };
  },
  async comment(repo, number, body) {
    const response = await fetch(
      `${apiBase}/repos/${repo.owner}/${repo.repo}/issues/${number}/comments`,
      {
        method: "POST",
        headers: await headers(repo),
        body: JSON.stringify({ body }),
      },
    );
    if (!response.ok) throw new Error(`github_api_${response.status}`);
  },
  async getDefaultBranch(repo) {
    const response = await fetch(`${apiBase}/repos/${repo.owner}/${repo.repo}`, {
      headers: await headers(repo),
    });
    if (!response.ok) throw new Error(`github_api_${response.status}`);
    const body = (await response.json()) as { default_branch?: string };
    if (!body.default_branch) throw new Error("github_api_invalid_response");
    return body.default_branch;
  },
  async getBranchSha(repo, branch) {
    const response = await fetch(
      `${apiBase}/repos/${repo.owner}/${repo.repo}/branches/${encodeURIComponent(branch)}`,
      { headers: await headers(repo) },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`github_api_${response.status}`);
    const body = (await response.json()) as { commit?: { sha?: string } };
    return body.commit?.sha ?? null;
  },
  async getCommit(repo, commitSha) {
    const response = await fetch(
      `${apiBase}/repos/${repo.owner}/${repo.repo}/commits/${encodeURIComponent(commitSha)}`,
      { headers: await headers(repo) },
    );
    if (response.status === 404) return false;
    if (!response.ok) throw new Error(`github_api_${response.status}`);
    return true;
  },
  async compareFiles(repo, base, head) {
    const files: string[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const response = await fetch(
        `${apiBase}/repos/${repo.owner}/${repo.repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?per_page=100&page=${page}`,
        { headers: await headers(repo) },
      );
      if (!response.ok) throw new Error(`github_api_${response.status}`);
      const body = (await response.json()) as { files?: Array<{ filename?: string }> };
      const pageFiles = (body.files ?? [])
        .map((file) => file.filename)
        .filter((filename): filename is string => Boolean(filename));
      files.push(...pageFiles);
      if (pageFiles.length < 100) break;
    }
    return files;
  },
  async createDraftPullRequest(repo, input) {
    const head = `${repo.owner}:${input.head}`;
    const existingResponse = await fetch(
      `${apiBase}/repos/${repo.owner}/${repo.repo}/pulls?head=${encodeURIComponent(head)}&state=all&per_page=100`,
      { headers: await headers(repo) },
    );
    if (!existingResponse.ok) throw new Error(`github_api_${existingResponse.status}`);
    const existing = (await existingResponse.json()) as Array<{
      number: number;
      html_url: string;
    }>;
    if (existing[0]) return { number: existing[0].number, url: existing[0].html_url };
    const response = await fetch(`${apiBase}/repos/${repo.owner}/${repo.repo}/pulls`, {
      method: "POST",
      headers: await headers(repo),
      body: JSON.stringify({ ...input, draft: true }),
    });
    if (!response.ok) throw new Error(`github_api_${response.status}`);
    const body = (await response.json()) as { number: number; html_url: string };
    return { number: body.number, url: body.html_url };
  },
};
