import { generateKeyPairSync, createVerify } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { githubIssuePublisher } from "./github";
import { getGithubToken, hasGithubCredentials } from "./githubAuth";

const repo = { owner: "owner", repo: "repo" };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeKeys() {
  return generateKeyPairSync("rsa", { modulusLength: 2048 });
}

function decodePart(value: string) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
}

describe("GitHub App authentication", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("creates a signed JWT with the expected app claims", async () => {
    const { privateKey, publicKey } = makeKeys();
    vi.stubEnv("GITHUB_APP_ID", "12345");
    vi.stubEnv(
      "GITHUB_APP_PRIVATE_KEY",
      privateKey.export({ type: "pkcs8", format: "pem" }).toString().replace(/\n/g, "\\n"),
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 42 }))
      .mockResolvedValueOnce(
        jsonResponse({ token: "installation-token", expires_at: "2099-01-01T00:00:00Z" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await getGithubToken({ owner: "jwt-owner", repo: "jwt-repo" });

    const authorization = fetchMock.mock.calls[0][1].headers.authorization as string;
    const [, encodedPayload, encodedSignature] = authorization.replace("Bearer ", "").split(".");
    const header = decodePart(authorization.replace("Bearer ", "").split(".")[0]);
    const payload = decodePart(encodedPayload);
    const verified = createVerify("RSA-SHA256")
      .update(authorization.replace("Bearer ", "").split(".").slice(0, 2).join("."))
      .verify(publicKey, Buffer.from(encodedSignature, "base64url"));

    expect({ alg: header.alg, typ: header.typ, iss: payload.iss, verified }).toEqual({
      alg: "RS256",
      typ: "JWT",
      iss: "12345",
      verified: true,
    });
    expect({
      iat: typeof payload.iat,
      exp: typeof payload.exp,
      lifetime: Number(payload.exp) - Number(payload.iat),
    }).toEqual({ iat: "number", exp: "number", lifetime: 600 });
  });

  it("resolves an installation and uses its token for GitHub requests", async () => {
    const { privateKey } = makeKeys();
    vi.stubEnv("GITHUB_APP_ID", "app-id");
    vi.stubEnv(
      "GITHUB_APP_PRIVATE_KEY",
      privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    );
    const marker = "<!-- vibecheck:fingerprint=test -->";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 99 }))
      .mockResolvedValueOnce(
        jsonResponse({ token: "installation-token", expires_at: "2099-01-01T00:00:00Z" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              number: 7,
              html_url: "https://github.com/owner/repo/issues/7",
              state: "open",
              body: marker,
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await githubIssuePublisher.findByMarker(repo, marker);

    expect(result?.number).toBe(7);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.github.com/repos/owner/repo/installation");
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://api.github.com/app/installations/99/access_tokens",
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({
      permissions: {
        contents: "read",
        pull_requests: "write",
        issues: "write",
      },
    });
    expect(fetchMock.mock.calls[2][1].headers.authorization).toBe("Bearer installation-token");
  });

  it("falls back to paginated repository issue reads when search is unavailable", async () => {
    const { privateKey } = makeKeys();
    vi.stubEnv("GITHUB_APP_ID", "app-id");
    vi.stubEnv(
      "GITHUB_APP_PRIVATE_KEY",
      privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    );
    const fallbackRepo = { owner: "fallback-owner", repo: "fallback-repo" };
    const marker = "<!-- vibecheck:fingerprint=fallback -->";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 101 }))
      .mockResolvedValueOnce(
        jsonResponse({ token: "installation-token", expires_at: "2099-01-01T00:00:00Z" }),
      )
      .mockResolvedValueOnce(jsonResponse({ message: "search unavailable" }, 403))
      .mockResolvedValueOnce(
        jsonResponse([
          {
            number: 8,
            html_url: "https://github.com/owner/repo/issues/8",
            state: "closed",
            body: `Older issue\n${marker}`,
          },
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await githubIssuePublisher.findByMarker(fallbackRepo, marker);

    expect(result).toEqual({
      number: 8,
      url: "https://github.com/owner/repo/issues/8",
      state: "closed",
      body: `Older issue\n${marker}`,
    });
    expect(fetchMock.mock.calls[3][0]).toBe(
      "https://api.github.com/repos/fallback-owner/fallback-repo/issues?state=all&per_page=100&page=1",
    );
  });

  it("normalizes a bare base64 PKCS#1 private key body", async () => {
    const { privateKey } = makeKeys();
    const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    const body = pem
      .replace("-----BEGIN RSA PRIVATE KEY-----", "")
      .replace("-----END RSA PRIVATE KEY-----", "")
      .replace(/\s+/g, "");
    vi.stubEnv("GITHUB_APP_ID", "bare-key-app");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", body);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 102 }))
      .mockResolvedValueOnce(
        jsonResponse({ token: "bare-key-token", expires_at: "2099-01-01T00:00:00Z" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    expect(await getGithubToken({ owner: "bare-owner", repo: "bare-repo" })).toBe("bare-key-token");
  });

  it("reuses cached tokens and refreshes them near expiration", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { privateKey } = makeKeys();
    vi.stubEnv("GITHUB_APP_ID", "app-id");
    vi.stubEnv(
      "GITHUB_APP_PRIVATE_KEY",
      privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 1 }))
      .mockResolvedValueOnce(
        jsonResponse({ token: "first-token", expires_at: "2026-01-01T01:00:00Z" }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: 1 }))
      .mockResolvedValueOnce(
        jsonResponse({ token: "second-token", expires_at: "2026-01-01T02:00:00Z" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    expect(await getGithubToken({ owner: "cache-owner", repo: "cache-repo" })).toBe("first-token");
    expect(await getGithubToken({ owner: "cache-owner", repo: "cache-repo" })).toBe("first-token");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.setSystemTime(new Date("2026-01-01T00:59:01Z"));
    expect(await getGithubToken({ owner: "cache-owner", repo: "cache-repo" })).toBe("second-token");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("uses the PAT fallback or returns null without credentials", async () => {
    vi.stubEnv("GITHUB_APP_ID", "");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "");
    vi.stubEnv("GITHUB_ISSUES_TOKEN", "development-pat");
    expect(hasGithubCredentials()).toBe(true);
    expect(await getGithubToken({ owner: "pat-owner", repo: "pat-repo" })).toBe("development-pat");

    vi.stubEnv("GITHUB_ISSUES_TOKEN", "");
    expect(hasGithubCredentials()).toBe(false);
    expect(await getGithubToken({ owner: "empty-owner", repo: "empty-repo" })).toBeNull();
  });
});
