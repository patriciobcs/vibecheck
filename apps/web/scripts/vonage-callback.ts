import { mergeArchiveWebhook } from "../src/lib/tunnel";

/**
 * `pnpm vonage:callback https://vibecheck.example.com`: points the Vonage application's
 * archive-status webhook at <base>/api/webhooks/vonage/archive using VONAGE_API_KEY/SECRET and
 * VONAGE_APPLICATION_ID from .env.local. Used once per deployment; `pnpm tunnel` does the same for
 * local development. The signature secret stays a dashboard setting.
 */
const base = process.argv[2];
if (!base || !/^https:\/\//.test(base)) {
  console.error("usage: pnpm vonage:callback https://<public-host>");
  process.exit(1);
}
const need = (k: string) => {
  const v = process.env[k];
  if (!v || /^REPLACE_WITH_/.test(v)) throw new Error(`${k} is not set`);
  return v;
};
async function main() {
  const appId = need("VONAGE_APPLICATION_ID");
  const auth = `Basic ${Buffer.from(`${need("VONAGE_API_KEY")}:${need("VONAGE_API_SECRET")}`).toString("base64")}`;
  const url = `https://api.nexmo.com/v2/applications/${appId}`;
  const current = await fetch(url, { headers: { Authorization: auth } });
  if (!current.ok)
    throw new Error(`GET application failed: ${current.status} ${await current.text()}`);
  const app = (await current.json()) as { name: string; capabilities: Record<string, unknown> };
  const callback = `${base.replace(/\/$/, "")}/api/webhooks/vonage/archive`;
  const body = mergeArchiveWebhook(
    { name: app.name, capabilities: app.capabilities ?? {} },
    callback,
  );
  const put = await fetch(url, {
    method: "PUT",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!put.ok) throw new Error(`PUT application failed: ${put.status} ${await put.text()}`);
  process.stdout.write(`archive_status webhook set to ${callback}\n`);
}
main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
