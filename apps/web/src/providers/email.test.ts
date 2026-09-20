import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, schema } from "@/db/client";
import { resetDb } from "@/test/db";
import { sendEmail, withTestInbox } from "./email";

vi.mock("@/lib/env", async () => {
  const { parseEnv } = await vi.importActual<typeof import("@/lib/env")>("@/lib/env");
  return { env: () => parseEnv(process.env) };
});

const message = {
  to: "founder@example.test",
  subject: "Sign in",
  text: "Open https://example.test/sign-in/test-token",
  actionUrl: "https://example.test/sign-in/test-token",
};

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("EMAIL_MODE", "test_inbox");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"id":"email-test"}')));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("email delivery", () => {
  it("uses the local inbox without contacting an email provider", async () => {
    expect(await sendEmail(message)).toMatchObject({ mode: "test_inbox" });
    expect(fetch).not.toHaveBeenCalled();
    expect(await db.query.notificationOutbox.findMany()).toMatchObject([
      { toEmail: message.to, status: "test_inbox", actionUrl: message.actionUrl },
    ]);
  });

  it("does not silently accept normal production sign-in without delivery", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(sendEmail(message)).rejects.toThrow("email_delivery_not_configured");
    expect(await db.$count(schema.notificationOutbox)).toBe(0);
  });

  it("requires real delivery credentials before writing an outgoing email", async () => {
    vi.stubEnv("EMAIL_MODE", "resend");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    await expect(sendEmail(message)).rejects.toThrow("email_delivery_not_configured");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends account links while keeping explicit demo links in the inbox", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EMAIL_MODE", "resend");
    vi.stubEnv("RESEND_API_KEY", "test-only-key");
    vi.stubEnv("EMAIL_FROM", "Seamless UX <login@example.test>");
    const [real, demo] = await Promise.all([
      sendEmail(message),
      withTestInbox(() => sendEmail({ ...message, to: "demo@example.test" })),
    ]);
    expect(real.mode).toBe("resend");
    expect(demo.mode).toBe("test_inbox");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          from: "Seamless UX <login@example.test>",
          to: [message.to],
          subject: message.subject,
          text: message.text,
        }),
      }),
    );
    const rows = await db.query.notificationOutbox.findMany();
    expect(rows.find((row) => row.toEmail === message.to)?.status).toBe("sent");
    expect(rows.find((row) => row.toEmail === "demo@example.test")?.status).toBe("test_inbox");
  });

  it("surfaces provider failures instead of recording a sent email", async () => {
    vi.stubEnv("EMAIL_MODE", "resend");
    vi.stubEnv("RESEND_API_KEY", "test-only-key");
    vi.stubEnv("EMAIL_FROM", "login@example.test");
    vi.mocked(fetch).mockResolvedValue(new Response("unavailable", { status: 503 }));
    await expect(sendEmail(message)).rejects.toThrow("email_delivery_failed");
    expect(await db.query.notificationOutbox.findMany()).toMatchObject([{ status: "queued" }]);
  });
});
