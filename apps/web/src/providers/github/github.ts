import { getGithubToken } from "./auth";
import type { IssuePublisher } from "./types";

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

export const githubIssuePublisher: IssuePublisher = {
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
};
