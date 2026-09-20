import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end: direct link → sign in (test inbox) → consent → device check, plus SDK safety.
 * Runs against `next dev` on port 3100 with the local Supabase database.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const useExisting = process.env.E2E_BASE_URL !== undefined;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  fullyParallel: false,
  // Tests share one database and the seed owner account: run files sequentially.
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    permissions: ["microphone"],
    launchOptions: {
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  // Next.js allows one dev server per directory: set E2E_BASE_URL=http://localhost:3000 to run
  // against an already running `pnpm dev` instead of starting a second one on :3100.
  webServer: useExisting
    ? undefined
    : {
        command: "pnpm exec next dev -p 3100",
        url: "http://localhost:3100/api/health",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          NEXT_PUBLIC_APP_URL: "http://localhost:3100",
          BETTER_AUTH_URL: "http://localhost:3100",
        },
      },
});
