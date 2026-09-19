import type { IssuePublisher, IssueRepository, PublishedIssue } from "./types";

const apiBase = "https://api.github.com";

function headers() {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${process.env.GITHUB_ISSUES_TOKEN ?? ""}`,
    "content-type": "application/json",
    "x-github-api-version": "2022-11-28",
  };
}

export const githubIssuePublisher: IssuePublisher = {
  async findByMarker(repo, marker) {
    const query = encodeURIComponent(`repo:${repo.owner}/${repo.repo} "${marker}" in:body`);
    const response = await fetch(`${apiBase}/search/issues?q=${query}`, { headers: headers() });
    if (!response.ok) throw new Error(`github_api_${response.status}`);
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
      headers: headers(),
      body: JSON.stringify(input),
    });
    if (response.ok) {
      const body = (await response.json()) as { number: number; html_url: string };
      return { number: body.number, url: body.html_url };
    }
    const retry = await fetch(`${apiBase}/repos/${repo.owner}/${repo.repo}/issues`, {
      method: "POST",
      headers: headers(),
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
        headers: headers(),
        body: JSON.stringify({ body }),
      },
    );
    if (!response.ok) throw new Error(`github_api_${response.status}`);
  },
};
