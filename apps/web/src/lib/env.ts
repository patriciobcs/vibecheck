import { z } from "zod";

const PLACEHOLDER = /^REPLACE_WITH_/;

/** Treat empty strings and .env.example placeholders as "not set". */
const optionalSecret = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" && !PLACEHOLDER.test(v) ? v : undefined));

const CoreSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url(),
  PUBLIC_WEBHOOK_BASE_URL: z.url().optional(),
  DATABASE_URL: z.string().min(1),
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_STORAGE_BUCKET: z.string().min(1).default("session-media"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.url().optional(),
  EMAIL_MODE: z.enum(["test_inbox"]).default("test_inbox"),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  WORKER_LEASE_SECONDS: z.coerce.number().int().positive().default(60),
  SEED_OWNER_EMAIL: z.email().default("owner@example.test"),
  VONAGE_APPLICATION_ID: optionalSecret,
  VONAGE_PRIVATE_KEY_PATH: optionalSecret,
  VONAGE_PRIVATE_KEY_BASE64: optionalSecret,
  VONAGE_ARCHIVE_SIGNATURE_SECRET: optionalSecret,
  VONAGE_SESSION_LOCATION: optionalSecret,
  SLNG_API_KEY: optionalSecret,
  SLNG_BASE_URL: z.url().default("https://api.slng.ai"),
  SLNG_STT_PATH: z.string().default("/v1/stt/slng/deepgram/nova:3-en"),
  SLNG_STT_LANGUAGE: z.string().default("en"),
});

export type VonageConfig = {
  applicationId: string;
  privateKey: string;
  archiveSignatureSecret: string | null;
  sessionLocation: string | null;
};

export type SlngConfig = { apiKey: string; sttUrl: string; language: string };

export type Env = z.infer<typeof CoreSchema> & {
  appUrl: string;
  webhookBaseUrl: string;
  vonage: VonageConfig | null;
  slng: SlngConfig | null;
};

type ReadFile = (path: string) => string;

export function parseEnv(
  raw: Record<string, string | undefined>,
  readFile: ReadFile = (p) => {
    // Lazy require keeps this module usable in the browser-safe env test.
    const fs = require("node:fs") as typeof import("node:fs");
    return fs.readFileSync(p, "utf8");
  },
): Env {
  const parsed = CoreSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join("\n")}`);
  }
  const core = parsed.data;

  let vonage: VonageConfig | null = null;
  if (core.VONAGE_APPLICATION_ID) {
    const privateKey = core.VONAGE_PRIVATE_KEY_BASE64
      ? Buffer.from(core.VONAGE_PRIVATE_KEY_BASE64, "base64").toString("utf8")
      : core.VONAGE_PRIVATE_KEY_PATH
        ? readFile(core.VONAGE_PRIVATE_KEY_PATH)
        : null;
    if (privateKey) {
      vonage = {
        applicationId: core.VONAGE_APPLICATION_ID,
        privateKey,
        archiveSignatureSecret: core.VONAGE_ARCHIVE_SIGNATURE_SECRET ?? null,
        sessionLocation: core.VONAGE_SESSION_LOCATION ?? null,
      };
    }
  }

  const slng: SlngConfig | null = core.SLNG_API_KEY
    ? {
        apiKey: core.SLNG_API_KEY,
        sttUrl: new URL(core.SLNG_STT_PATH, core.SLNG_BASE_URL).toString(),
        language: core.SLNG_STT_LANGUAGE,
      }
    : null;

  return {
    ...core,
    appUrl: core.NEXT_PUBLIC_APP_URL,
    webhookBaseUrl: core.PUBLIC_WEBHOOK_BASE_URL ?? core.NEXT_PUBLIC_APP_URL,
    vonage,
    slng,
  };
}

let cached: Env | null = null;

/** Server-only. Parsed once per process; throws with a readable list of problems. */
export function env(): Env {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}
