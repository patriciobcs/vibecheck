import { z } from "zod";

const PLACEHOLDER = /^REPLACE_WITH_/;

/** Treat empty strings and .env.example placeholders as "not set". */
const optionalSecret = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" && !PLACEHOLDER.test(v) ? v : undefined));

const CoreSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url(),
  APP_BASE_URL: z.url().optional(),
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
  // VC-01 discovery
  DISCOVERY_PROVIDER: z.enum(["fixture", "devin"]).default("fixture"),
  ANALYSIS_PROVIDER: z.enum(["fixture", "devin"]).optional(),
  REPAIR_PROVIDER: z.enum(["fixture", "devin"]).default("fixture"),
  VALIDATOR: z.enum(["fixture"]).default("fixture"),
  PREVIEW_PROVIDER: z.enum(["fixture", "vercel"]).default("fixture"),
  VERCEL_TOKEN: optionalSecret,
  VERCEL_PROJECT_ID: optionalSecret,
  VERCEL_TEAM_ID: optionalSecret,
  VERCEL_API_BASE: z.url().default("https://api.vercel.com"),
  VERCEL_DEPLOY_TIMEOUT_MS: z.coerce.number().int().positive().default(900_000),
  VERCEL_POLL_MS: z.coerce.number().int().positive().default(10_000),
  SUMMARY_PROVIDER: z.enum(["fixture", "devin"]).default("fixture"),
  DEVIN_API_KEY: optionalSecret,
  DEVIN_API_BASE: z.url().default("https://api.devin.ai/v1"),
  DEVIN_POLL_MS: z.coerce.number().int().positive().default(10_000),
  DEVIN_TIMEOUT_MS: z.coerce.number().int().positive().default(1_200_000),
  DEVIN_MAX_ACU: z.coerce.number().positive().default(5),
  GITHUB_APP_ID: optionalSecret,
  GITHUB_APP_PRIVATE_KEY: optionalSecret,
  GITHUB_ISSUES_TOKEN: optionalSecret,
  ISSUE_PUBLISHER: z.enum(["github", "memory"]).default("github"),
  ALLOW_LOCAL_TARGETS: z.enum(["true", "false"]).default("false"),
  DEV_API_KEY: optionalSecret,
  /** Hides developer-only copy (seed hints, SDK snippets, test inbox) and enables one-click demo sign-in. Never in production. */
  DEMO_MODE: z.enum(["true", "false"]).default("false"),
  // Jev screening (typesafe.ai)
  JEV_API_KEY: optionalSecret,
  JEV_BASE_URL: z.url().default("https://api.typesafe.ai"),
  JEV_MODEL: z.string().default("jev-latest"),
  /** USD per 1k tokens; both must be set for the daily spend cap to be enforceable. */
  JEV_PRICE_PER_1K_INPUT_USD: z.coerce.number().nonnegative().optional(),
  JEV_PRICE_PER_1K_OUTPUT_USD: z.coerce.number().nonnegative().optional(),
});

export type VonageConfig = {
  applicationId: string;
  privateKey: string;
  archiveSignatureSecret: string | null;
  sessionLocation: string | null;
};

export type SlngConfig = { apiKey: string; sttUrl: string; language: string };
export type DevinConfig = {
  apiKey: string;
  baseUrl: string;
  pollMs: number;
  timeoutMs: number;
  maxAcu: number;
};

export type JevEnvConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  priceMicrosPer1k: { input: number; output: number } | null;
};

export type Env = Omit<z.infer<typeof CoreSchema>, "ANALYSIS_PROVIDER"> & {
  ANALYSIS_PROVIDER: "fixture" | "devin";
  appUrl: string;
  /** DEMO_MODE=true outside production: developer copy hidden, one-click demo sign-in. */
  demo: boolean;
  webhookBaseUrl: string;
  vonage: VonageConfig | null;
  slng: SlngConfig | null;
  devin: DevinConfig | null;
  jev: JevEnvConfig | null;
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
  const analysisProvider = core.ANALYSIS_PROVIDER ?? core.DISCOVERY_PROVIDER;

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

  const devin: DevinConfig | null = core.DEVIN_API_KEY
    ? {
        apiKey: core.DEVIN_API_KEY,
        baseUrl: core.DEVIN_API_BASE,
        pollMs: core.DEVIN_POLL_MS,
        timeoutMs: core.DEVIN_TIMEOUT_MS,
        maxAcu: core.DEVIN_MAX_ACU,
      }
    : null;

  const jev: JevEnvConfig | null = core.JEV_API_KEY
    ? {
        apiKey: core.JEV_API_KEY,
        baseUrl: core.JEV_BASE_URL,
        model: core.JEV_MODEL,
        priceMicrosPer1k:
          core.JEV_PRICE_PER_1K_INPUT_USD !== undefined &&
          core.JEV_PRICE_PER_1K_OUTPUT_USD !== undefined
            ? {
                input: Math.round(core.JEV_PRICE_PER_1K_INPUT_USD * 1_000_000),
                output: Math.round(core.JEV_PRICE_PER_1K_OUTPUT_USD * 1_000_000),
              }
            : null,
      }
    : null;

  return {
    ...core,
    ANALYSIS_PROVIDER: analysisProvider,
    devin,
    jev,
    appUrl: core.NEXT_PUBLIC_APP_URL,
    demo: core.DEMO_MODE === "true" && process.env.NODE_ENV !== "production",
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
