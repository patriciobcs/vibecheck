import { createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getGithubToken } from "./auth";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.GITHUB_APP_ID;
  delete process.env.GITHUB_APP_PRIVATE_KEY;
  delete process.env.GITHUB_ISSUES_TOKEN;
});

describe("GitHub App authentication", () => {
  it("normalizes bare base64 PKCS#1 keys and exchanges an installation token", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    process.env.GITHUB_APP_ID = "123";
    process.env.GITHUB_APP_PRIVATE_KEY = pem.replace(
      /-----BEGIN RSA PRIVATE KEY-----|-----END RSA PRIVATE KEY-----|\s/g,
      "",
    );
    const calls: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(new Request(input, init));
        if (String(input).endsWith("/installation"))
          return new Response(JSON.stringify({ id: 99 }), { status: 200 });
        const authorization = calls.at(-1)?.headers.get("authorization") ?? "";
        const jwt = authorization.slice("Bearer ".length);
        const [header, payload, signature] = jwt.split(".");
        const verify = createVerify("RSA-SHA256");
        verify.update(`${header}.${payload}`);
        expect(verify.verify(publicKey, signature, "base64url")).toBe(true);
        expect(JSON.parse(Buffer.from(payload, "base64url").toString()).iss).toBe("123");
        return new Response(
          JSON.stringify({
            token: "ghs_test",
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
          }),
          { status: 201 },
        );
      }),
    );
    await expect(getGithubToken({ owner: "minasrc", repo: "excalidraw-demo" })).resolves.toBe(
      "ghs_test",
    );
    expect(calls.map((request) => request.url)).toEqual([
      "https://api.github.com/repos/minasrc/excalidraw-demo/installation",
      "https://api.github.com/app/installations/99/access_tokens",
    ]);
  });

  it("uses the development PAT fallback or null", async () => {
    process.env.GITHUB_ISSUES_TOKEN = "ghp_test";
    await expect(getGithubToken({ owner: "o", repo: "r" })).resolves.toBe("ghp_test");
    delete process.env.GITHUB_ISSUES_TOKEN;
    await expect(getGithubToken({ owner: "o", repo: "r" })).resolves.toBeNull();
  });

  it("reuses cached tokens and refreshes them near expiry", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.GITHUB_APP_ID = "456";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey
      .export({ type: "pkcs1", format: "pem" })
      .toString();
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    let exchanges = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/installation"))
          return new Response(JSON.stringify({ id: 100 }), { status: 200 });
        exchanges += 1;
        return new Response(
          JSON.stringify({
            token: `ghs_cached_${exchanges}`,
            expires_at: new Date(now + 3_600_000).toISOString(),
          }),
          { status: 201 },
        );
      }),
    );
    const repo = { owner: "cache-owner", repo: "cache-repo" };
    await expect(getGithubToken(repo)).resolves.toBe("ghs_cached_1");
    await expect(getGithubToken(repo)).resolves.toBe("ghs_cached_1");
    expect(exchanges).toBe(1);

    vi.mocked(Date.now).mockReturnValue(now + 3_540_001);
    await expect(getGithubToken(repo)).resolves.toBe("ghs_cached_2");
    expect(exchanges).toBe(2);
  });
});
