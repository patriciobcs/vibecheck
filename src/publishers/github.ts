import type { IssuePublisher, IssueRepository, PublishedIssue } from "./types";
import { getGithubToken } from "./githubAuth";

const apiBase = "https://api.github.com";

async function headers(repo: IssueRepository) {
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
    const query = encodeURIComponent(`repo:${repo.owner}/${repo.repo} "${marker}" in:body`);
    const requestHeaders = await headers(repo);
    const response = await fetch(`${apiBase}/search/issues?q=${query}`, {
      headers: requestHeaders,
    });
    if (!response.ok && response.status !== 403 && response.status !== 422) {
      throw new Error(`github_api_${response.status}`);
    }
    if (!response.ok) {
      for (let page = 1; page <= 5; page += 1) {
        const fallbackResponse = await fetch(
          `${apiBase}/repos/${repo.owner}/${repo.repo}/issues?state=all&per_page=100&page=${page}`,
          { headers: requestHeaders },
        );
        if (!fallbackResponse.ok) throw new Error(`github_api_${fallbackResponse.status}`);
        const fallbackItems = (await fallbackResponse.json()) as Array<{
          number: number;
          html_url: string;
          state: "open" | "closed";
          body: string | null;
        }>;
        const fallbackItem = fallbackItems.find((item) => item.body?.includes(marker));
        if (fallbackItem) {
          return {
            number: fallbackItem.number,
            url: fallbackItem.html_url,
            state: fallbackItem.state,
            body: fallbackItem.body ?? "",
          };
        }
        if (fallbackItems.length < 100) return null;
      }
      return null;
    }
    const body = (await response.json()) as {
      items?: Array<{
        number: number;
        html_url: string;
        state: "open" | "closed";
        body: string | null;
      }>;
    };
    const item = body.items?.[0];
    return item
      ? { number: item.number, url: item.html_url, state: item.state, body: item.body ?? "" }
      : null;
  },
  async create(repo, input) {
    const response = await fetch(`${apiBase}/repos/${repo.owner}/${repo.repo}/issues`, {
      method: "POST",
      headers: await headers(repo),
      body: JSON.stringify(input),
    });
    if (response.ok) {
      const body = (await response.json()) as { number: number; html_url: string };
      return { number: body.number, url: body.html_url };
    }
    const retry = await fetch(`${apiBase}/repos/${repo.owner}/${repo.repo}/issues`, {
      method: "POST",
      headers: await headers(repo),
      body: JSON.stringify({ ...input, labels: [] }),
    });
    if (!retry.ok) throw new Error(`github_api_${retry.status}`);
    const body = (await retry.json()) as { number: number; html_url: string };
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
};
