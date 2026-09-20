import { describe, expect, it } from "vitest";
import { mergeArchiveWebhook, parseTunnelUrl, upsertEnvValue } from "./tunnel";

describe("parseTunnelUrl", () => {
  it("finds the trycloudflare hostname in cloudflared output", () => {
    const line =
      "2026-09-19T18:00:00Z INF |  https://quiet-otter-fox.trycloudflare.com                            |";
    expect(parseTunnelUrl(line)).toBe("https://quiet-otter-fox.trycloudflare.com");
  });

  it("returns null for unrelated lines", () => {
    expect(parseTunnelUrl("INF Requesting new quick Tunnel on trycloudflare.com...")).toBeNull();
  });
});

describe("upsertEnvValue", () => {
  it("replaces an existing key and appends a missing one", () => {
    const src = "A=1\nPUBLIC_WEBHOOK_BASE_URL=http://localhost:3000\nB=2\n";
    const out = upsertEnvValue(src, "PUBLIC_WEBHOOK_BASE_URL", "https://x.trycloudflare.com");
    expect(out).toBe("A=1\nPUBLIC_WEBHOOK_BASE_URL=https://x.trycloudflare.com\nB=2\n");
    expect(upsertEnvValue("A=1\n", "NEW", "v")).toBe("A=1\nNEW=v\n");
  });
});

describe("mergeArchiveWebhook", () => {
  it("keeps other capabilities and video webhooks while replacing archive_status", () => {
    const app = {
      name: "VibeCheck",
      capabilities: {
        video: {
          webhooks: {
            archive_status: { address: "https://old", active: true },
            session_created: { address: "https://s", active: false },
          },
        },
        rtc: { webhooks: { event_url: { address: "https://e", http_method: "POST" } } },
      },
    };
    const merged = mergeArchiveWebhook(
      app,
      "https://new.trycloudflare.com/api/webhooks/vonage/archive",
    );
    expect(merged.capabilities.video.webhooks.archive_status).toEqual({
      address: "https://new.trycloudflare.com/api/webhooks/vonage/archive",
      active: true,
    });
    expect(merged.capabilities.video.webhooks.session_created).toEqual({
      address: "https://s",
      active: false,
    });
    expect(merged.capabilities.rtc).toEqual(app.capabilities.rtc);
  });

  it("adds the video capability when the app has none", () => {
    const merged = mergeArchiveWebhook({ name: "x", capabilities: {} }, "https://n/hook");
    expect(merged.capabilities.video.webhooks.archive_status.address).toBe("https://n/hook");
  });
});
