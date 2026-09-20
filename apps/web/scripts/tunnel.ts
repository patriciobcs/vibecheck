import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { mergeArchiveWebhook, parseTunnelUrl, upsertEnvValue } from "../src/lib/tunnel";

/**
 * `pnpm tunnel [port]`: starts a cloudflared quick tunnel to the dev server, writes the
 * public URL into .env.local as PUBLIC_WEBHOOK_BASE_URL, and points the Vonage application's
 * archive-status webhook at /api/webhooks/vonage/archive using the account API key/secret.
 * The signature secret stays a one-time dashboard step (the API exposes no field for it).
 * Restart `pnpm dev` after the first run so the app picks up the new env value.
 */
const port = Number(process.argv[2] ?? process.env.PORT ?? 3000);
const ENV_FILE = ".env.local";
const PLACEHOLDER = /^REPLACE_WITH_/;
const configured = (v: string | undefined) => (v && !PLACEHOLDER.test(v) ? v : null);

/**
 * Named tunnel mode: set CLOUDFLARE_TUNNEL_NAME (created with `cloudflared tunnel create` and
 * routed with `cloudflared tunnel route dns`) plus a stable PUBLIC_WEBHOOK_BASE_URL. The hostname
 * then never changes, so the Vonage webhook is only reconciled, not rewritten.
 */
const namedTunnel = configured(process.env.CLOUDFLARE_TUNNEL_NAME);
const stableUrl = configured(process.env.PUBLIC_WEBHOOK_BASE_URL);
if (namedTunnel && (!stableUrl || /localhost|127\.0\.0\.1/.test(stableUrl))) {
  console.error(
    "[tunnel] CLOUDFLARE_TUNNEL_NAME is set but PUBLIC_WEBHOOK_BASE_URL is not a public https URL",
  );
  process.exit(1);
}

const args = namedTunnel
  ? ["tunnel", "run", "--url", `http://localhost:${port}`, namedTunnel]
  : ["tunnel", "--url", `http://localhost:${port}`];
const child = spawn("cloudflared", args, { stdio: ["ignore", "pipe", "pipe"] });
let announced = false;

if (namedTunnel && stableUrl) {
  announced = true;
  void configure(stableUrl).catch((err) => {
    console.error("[tunnel] configuration failed:", err instanceof Error ? err.message : err);
  });
}

function onLine(line: string) {
  process.stderr.write(`${line}\n`);
  if (announced) return;
  const url = parseTunnelUrl(line);
  if (!url) return;
  announced = true;
  void configure(url).catch((err) => {
    console.error("[tunnel] configuration failed:", err instanceof Error ? err.message : err);
  });
}

for (const stream of [child.stdout, child.stderr]) {
  let buffer = "";
  stream.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const l of lines) onLine(l);
  });
}

child.on("exit", (code) => {
  console.info(`[tunnel] cloudflared exited (${code ?? "signal"})`);
  process.exit(code ?? 0);
});
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => child.kill(sig));

async function configure(url: string) {
  const callback = `${url}/api/webhooks/vonage/archive`;
  const current = readFileSync(ENV_FILE, "utf8");
  writeFileSync(ENV_FILE, upsertEnvValue(current, "PUBLIC_WEBHOOK_BASE_URL", url));
  console.info(
    `\n[tunnel] public URL: ${url}\n[tunnel] wrote PUBLIC_WEBHOOK_BASE_URL to ${ENV_FILE} (restart pnpm dev if it was already running)`,
  );

  const appId = configured(process.env.VONAGE_APPLICATION_ID);
  const apiKey = configured(process.env.VONAGE_API_KEY);
  const apiSecret = configured(process.env.VONAGE_API_SECRET);
  if (!appId || !apiKey || !apiSecret) {
    console.info(
      `[tunnel] VONAGE_API_KEY/VONAGE_API_SECRET/VONAGE_APPLICATION_ID not set; set the archive callback manually to:\n         ${callback}`,
    );
    return;
  }

  const auth = `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`;
  const base = `https://api.nexmo.com/v2/applications/${appId}`;
  const getRes = await fetch(base, { headers: { Authorization: auth } });
  if (!getRes.ok)
    throw new Error(`GET application failed: ${getRes.status} ${await getRes.text()}`);
  const app = (await getRes.json()) as { name: string; capabilities: Record<string, unknown> };
  const body = mergeArchiveWebhook(
    { name: app.name, capabilities: app.capabilities ?? {} },
    callback,
  );
  const putRes = await fetch(base, {
    method: "PUT",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!putRes.ok)
    throw new Error(`PUT application failed: ${putRes.status} ${await putRes.text()}`);
  const updated = (await putRes.json()) as {
    capabilities?: { video?: { webhooks?: { archive_status?: { address?: string } } } };
  };
  const saved = updated.capabilities?.video?.webhooks?.archive_status?.address;
  console.info(`[tunnel] Vonage archive_status webhook now: ${saved ?? "(not returned)"}`);
  if (!configured(process.env.VONAGE_ARCHIVE_SIGNATURE_SECRET)) {
    console.warn(
      "[tunnel] VONAGE_ARCHIVE_SIGNATURE_SECRET is not set: enable the signature secret in the dashboard once and paste it into .env.local, or callbacks will be rejected.",
    );
  }
}
