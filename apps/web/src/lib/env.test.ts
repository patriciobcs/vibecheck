import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const valid = {
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  PUBLIC_WEBHOOK_BASE_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54332/postgres",
  SUPABASE_URL: "http://127.0.0.1:54331",
  SUPABASE_SERVICE_ROLE_KEY: "key",
  SUPABASE_STORAGE_BUCKET: "session-media",
  BETTER_AUTH_SECRET: "0123456789012345678901234567890123456789",
  BETTER_AUTH_URL: "http://localhost:3000",
  EMAIL_MODE: "test_inbox",
};

describe("parseEnv", () => {
  it("parses required core settings and leaves providers unconfigured", () => {
    const env = parseEnv(valid);
    expect(env.DATABASE_URL).toBe(valid.DATABASE_URL);
    expect(env.ANALYSIS_PROVIDER).toBe("fixture");
    expect(env.vonage).toBeNull();
    expect(env.slng).toBeNull();
  });

  it("defaults analysis provider to the discovery provider", () => {
    expect(parseEnv({ ...valid, DISCOVERY_PROVIDER: "devin" }).ANALYSIS_PROVIDER).toBe("devin");
  });

  it("treats REPLACE_WITH_ placeholders as unconfigured", () => {
    const env = parseEnv({
      ...valid,
      SLNG_API_KEY: "REPLACE_WITH_slng_api_key",
      VONAGE_APPLICATION_ID: "REPLACE_WITH_application_id",
    });
    expect(env.slng).toBeNull();
    expect(env.vonage).toBeNull();
  });

  it("builds provider config when keys are present", () => {
    const env = parseEnv({
      ...valid,
      SLNG_API_KEY: "sk_live",
      SLNG_BASE_URL: "https://api.slng.ai",
      SLNG_STT_PATH: "/v1/stt/slng/deepgram/nova:3-en",
      VONAGE_APPLICATION_ID: "app-id",
      VONAGE_PRIVATE_KEY_BASE64: Buffer.from("-----BEGIN PRIVATE KEY-----").toString("base64"),
      VONAGE_ARCHIVE_SIGNATURE_SECRET: "sig",
    });
    expect(env.slng?.sttUrl).toBe("https://api.slng.ai/v1/stt/slng/deepgram/nova:3-en");
    expect(env.vonage?.privateKey.startsWith("-----BEGIN")).toBe(true);
  });

  it("fails loudly when the auth secret is too short", () => {
    expect(() => parseEnv({ ...valid, BETTER_AUTH_SECRET: "short" })).toThrow(/BETTER_AUTH_SECRET/);
  });
});
