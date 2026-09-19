import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * Design check only (opt-in): captures the live board in its main states. Playwright's global
 * setup resets the sample studies, so run it together with live-session.spec.ts (which sorts
 * first) to get the study view: `SHOTS=1 LIVE_PROVIDERS=1 … playwright test e2e/live-session.spec.ts e2e/live-shots.spec.ts`.
 */
const owner = process.env.SEED_OWNER_EMAIL ?? "owner@example.test";
const OUT = process.env.SHOT_DIR ?? "test-results/shots";

test.skip(process.env.SHOTS !== "1", "set SHOTS=1 to capture live board screenshots");

test("live board screenshots", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, page.request, owner);

  // Waiting state: a fresh product with no sessions.
  const created = await page.request.post("/api/products", {
    data: { name: `Shot product ${Date.now()}`, url: "https://example.com" },
  });
  const fresh = (await created.json()) as { id: string };
  await page.goto(`/products/${fresh.id}/monitoring/live`);
  await expect(page.getByText("Waiting for the first session")).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/live-waiting.png`, fullPage: true });

  // Board: the Excalidraw demo product with existing sessions.
  await page.goto("/products/product_excalidraw_local/monitoring/live");
  await expect(page.getByRole("heading", { name: "Live analysis" })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/live-board.png`, fullPage: true });

  // Study session view, pinned through the URL.
  const feedRes = await page.request.get("/api/owner/products/product_excalidraw_local/live");
  const feed = (await feedRes.json()) as { sessions?: { kind: string; id: string }[] };
  const study = feed.sessions?.find((s) => s.kind === "study");
  if (study) {
    await page.goto(`/products/product_excalidraw_local/monitoring/live?session=study:${study.id}`);
    await expect(page.getByRole("heading", { name: "Task" })).toBeVisible();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/live-study.png`, fullPage: true });
  }
});
