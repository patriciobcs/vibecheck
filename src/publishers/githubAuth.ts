import { createSign } from "node:crypto";
import type { IssueRepository } from "./types";

type CachedToken = {
  token: string;
  expiresAt: number;
};

const tokenCache = new Map<string, CachedToken>();
const apiBase = "https://api.github.com";

function normalizePrivateKey(value: string) {
  const normalized = value.replace(/\\n/g, "\n").trim();
  if (normalized.includes("-----BEGIN")) return normalized;
  const body = normalized.replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g)?.join("\n") ?? "";
  return `-----BEGIN RSA PRIVATE KEY-----\n${lines}\n-----END RSA PRIVATE KEY-----\n`;
}

function appCredentials() {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.trim();
  return appId && privateKey ? { appId, privateKey: normalizePrivateKey(privateKey) } : null;
}

function encode(value: object) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function appJwt(appId: string, privateKey: string) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iat: now - 60,
    exp: now + 540,
    iss: appId,
  })}`;
  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .sign(privateKey)
    .toString("base64url");
  return `${unsigned}.${signature}`;
}

async function requireResponse(response: Response) {
  if (!response.ok) throw new Error(`github_app_auth_${response.status}`);
  return response;
}

export function hasGithubCredentials() {
  return Boolean(appCredentials() || process.env.GITHUB_ISSUES_TOKEN);
}

export async function getGithubToken(repo: IssueRepository): Promise<string | null> {
  const credentials = appCredentials();
  if (!credentials) return process.env.GITHUB_ISSUES_TOKEN || null;

  const cacheKey = `${repo.owner}/${repo.repo}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt - Date.now() >= 60_000) return cached.token;

  const jwt = appJwt(credentials.appId, credentials.privateKey);
  const appHeaders = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${jwt}`,
    "x-github-api-version": "2022-11-28",
  };
  const installationResponse = await requireResponse(
    await fetch(`${apiBase}/repos/${repo.owner}/${repo.repo}/installation`, {
      headers: appHeaders,
    }),
  );
  const installation = (await installationResponse.json()) as { id?: number };
  if (!installation.id) throw new Error("github_app_auth_invalid_response");

  const tokenResponse = await requireResponse(
    await fetch(`${apiBase}/app/installations/${installation.id}/access_tokens`, {
      method: "POST",
      headers: { ...appHeaders, "content-type": "application/json" },
      body: JSON.stringify({ permissions: { issues: "write" } }),
    }),
  );
  const token = (await tokenResponse.json()) as { token?: string; expires_at?: string };
  const expiresAt = token.expires_at ? Date.parse(token.expires_at) : Number.NaN;
  if (!token.token || !Number.isFinite(expiresAt)) {
    throw new Error("github_app_auth_invalid_response");
  }
  tokenCache.set(cacheKey, { token: token.token, expiresAt });
  return token.token;
}
