import { sql } from "../src/db/client";
import { DEMO_PRODUCT_ID, resetDemoProduct } from "../src/db/demo-reset";

/**
 * `pnpm demo:reset` (local, .env.local) / `pnpm demo:reset:prod` (.env.production.local): empties the
 * Excalidraw demo product's live console before a demo. Deletes sessions, media, passive data and
 * candidates of that one product only; see resetDemoProduct for the exact scope.
 */
async function main() {
  const removed = await resetDemoProduct();
  console.info(`${DEMO_PRODUCT_ID} reset: ${JSON.stringify(removed)}`);
  await sql.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
