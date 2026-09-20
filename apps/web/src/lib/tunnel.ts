/** Pure helpers behind `pnpm tunnel` (see scripts/tunnel.ts). Kept separate so they are unit-testable. */

const TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

export function parseTunnelUrl(line: string): string | null {
  return line.match(TUNNEL_URL)?.[0] ?? null;
}

/** Replaces `KEY=...` in a dotenv file body, or appends it when missing. */
export function upsertEnvValue(source: string, key: string, value: string): string {
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(source)) return source.replace(re, `${key}=${value}`);
  return `${source.endsWith("\n") || source === "" ? source : `${source}\n`}${key}=${value}\n`;
}

type Webhook = { address: string; active?: boolean; http_method?: string };
type VonageApplication = {
  name: string;
  capabilities: Record<string, unknown> & { video?: { webhooks?: Record<string, Webhook> } };
};

/** Returns a PUT body that only changes the video archive_status webhook address. */
export function mergeArchiveWebhook<T extends VonageApplication>(app: T, address: string) {
  const video = app.capabilities.video ?? {};
  return {
    ...app,
    capabilities: {
      ...app.capabilities,
      video: {
        ...video,
        webhooks: { ...(video.webhooks ?? {}), archive_status: { address, active: true } },
      },
    },
  };
}
