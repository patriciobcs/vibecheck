import { createSign } from "node:crypto";
import type { IssueRepository } from "./types";

type CachedToken = { token: string; expiresAt: number };
const tokenCache = new Map<string, CachedToken>();
const apiBase = "https://api.github.com";

function normalizePrivateKey(value: string) {
  const normalized = value.replace(/\\n/g, "\n").trim();
  if (normalized.includes("-----BEGIN")) return normalized;
  const body = normalized.replace(/\s+/g, "");
  return `-----BEGIN RSA PRIVATE KEY-----\n${body.match(/.{1,64}/g)?.join("\n") ?? ""}\n-----END RSA PRIVATE KEY-----\n`;
}

function appCredentials() {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const key = process.env.GITHUB_APP_PRIVATE_KEY?.trim();
  return appId && key ? { appId, privateKey: normalizePrivateKey(key) } : null;
}

function jwt(appId: string, privateKey: string) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: now - 60, exp: now + 540, iss: appId })}`;
  return `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(privateKey).toString("base64url")}`;
}

export function hasGithubCredentials() {
  return Boolean(appCredentials() || process.env.GITHUB_ISSUES_TOKEN);
}

export async function getGithubToken(repo: IssueRepository): Promise<string | null> {
  const credentials = appCredentials();
  if (!credentials) return process.env.GITHUB_ISSUES_TOKEN?.trim() || null;
  const cacheKey = `${repo.owner}/${repo.repo}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt - Date.now() >= 60_000) return cached.token;
  const appJwt = jwt(credentials.appId, credentials.privateKey);
  const appHeaders = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${appJwt}`,
    "x-github-api-version": "2022-11-28",
  };
  const installationResponse = await fetch(
    `${apiBase}/repos/${repo.owner}/${repo.repo}/installation`,
    {
      headers: appHeaders,
    },
  );
  if (!installationResponse.ok) throw new Error(`github_app_auth_${installationResponse.status}`);
  const installation = (await installationResponse.json()) as { id?: number };
  if (!installation.id) throw new Error("github_app_auth_invalid_response");
  const tokenResponse = await fetch(
    `${apiBase}/app/installations/${installation.id}/access_tokens`,
    {
      method: "POST",
      headers: { ...appHeaders, "content-type": "application/json" },
      body: JSON.stringify({ permissions: { issues: "write" } }),
    },
  );
  if (!tokenResponse.ok) throw new Error(`github_app_auth_${tokenResponse.status}`);
  const token = (await tokenResponse.json()) as { token?: string; expires_at?: string };
  const expiresAt = token.expires_at ? Date.parse(token.expires_at) : Number.NaN;
  if (!token.token || !Number.isFinite(expiresAt))
    throw new Error("github_app_auth_invalid_response");
  tokenCache.set(cacheKey, { token: token.token, expiresAt });
  return token.token;
}
