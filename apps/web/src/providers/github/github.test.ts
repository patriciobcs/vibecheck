import { afterEach, describe, expect, it, vi } from "vitest";
import { githubIssuePublisher } from "./github";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GITHUB_ISSUES_TOKEN;
});

describe("GitHub issue publisher", () => {
  it("falls back to repository pagination when search is unavailable", async () => {
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    process.env.GITHUB_ISSUES_TOKEN = "ghp_test";
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input));
        if (String(input).includes("/search/issues"))
          return new Response("search unavailable", { status: 403 });
        return new Response(
          JSON.stringify([
            {
              number: 7,
              html_url: "https://github.com/o/r/issues/7",
              state: "open",
              body: "managed issue <!-- vibecheck:fingerprint=abc -->",
            },
          ]),
          { status: 200 },
        );
      }),
    );
    await expect(
      githubIssuePublisher.findByMarker(
        { owner: "o", repo: "r" },
        "<!-- vibecheck:fingerprint=abc -->",
      ),
    ).resolves.toEqual({
      number: 7,
      url: "https://github.com/o/r/issues/7",
      state: "open",
      body: "managed issue <!-- vibecheck:fingerprint=abc -->",
    });
    expect(calls).toEqual([
      "https://api.github.com/search/issues?q=repo%3Ao%2Fr%20%22%3C!--%20vibecheck%3Afingerprint%3Dabc%20--%3E%22%20in%3Abody",
      "https://api.github.com/repos/o/r/issues?state=all&per_page=100&page=1",
    ]);
  });
});
