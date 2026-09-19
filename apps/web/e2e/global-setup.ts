import { execSync } from "node:child_process";

/** Seeds the labeled sample tenant/product/study (idempotent) so the flows have something to test. */
export default function globalSetup() {
  execSync("pnpm db:seed", { stdio: "inherit" });
  execSync("pnpm db:reset-sample", { stdio: "inherit" });
}
