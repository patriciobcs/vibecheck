import { execSync } from "node:child_process";

/** Seeds the labeled sample tenant/product/study (idempotent) so the flows have something to test. */
export default function globalSetup() {
  // The sample product's URL must point at the server under test.
  const env = {
    ...process.env,
    DEV_API_KEY: process.env.DEV_API_KEY ?? "dev_local_key_1",
    NEXT_PUBLIC_APP_URL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    SKIP_STORAGE_SETUP: "true",
  };
  execSync("pnpm db:seed", { stdio: "inherit", env });
  execSync("pnpm db:reset-sample", { stdio: "inherit", env });
}
