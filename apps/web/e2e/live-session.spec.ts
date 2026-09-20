import path from "node:path";
import { chromium, expect, test } from "@playwright/test";

/**
 * Simulated end-to-end session against the REAL providers (Vonage, cloudflared callback, SLNG):
 * a fake microphone plays a synthesized sentence, the screen picker is auto-selected, and the test
 * waits for the archive callback, the download and the transcript. Opt in with LIVE_PROVIDERS=1
 * while `pnpm dev`, `pnpm tunnel` and the Excalidraw clone (:3200) are running.
 */
const LIVE = process.env.LIVE_PROVIDERS === "1";
const APP = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const TARGET = process.env.LIVE_TARGET_URL ?? "http://localhost:3200/";
const SPEECH = path.resolve(__dirname, "fixtures/speech.wav");

test.skip(!LIVE, "set LIVE_PROVIDERS=1 to run the live provider session");
test.setTimeout(6 * 60_000);

test("speech from a fake microphone ends up as a transcript aligned to a verified recording", async () => {
  const browser = await chromium.launch({
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${SPEECH}`,
      "--auto-select-desktop-capture-source=Entire screen",
    ],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.grantPermissions(["microphone"], { origin: APP });
  await ctx.grantPermissions(["microphone"], { origin: new URL(TARGET).origin });
  const page = await ctx.newPage();
  let assignmentId: string | null = null;
  page.on("response", async (r) => {
    if (r.url().endsWith("/api/embed/claim") && r.ok())
      assignmentId = ((await r.json()) as { assignment_id: string }).assignment_id;
  });

  await page.goto(TARGET, { waitUntil: "load" });
  await page.locator(".vc-toast").waitFor({ timeout: 20_000 });
  await page.getByRole("button", { name: "See the task" }).click();
  const dialog = page.frameLocator('iframe[title="VibeCheck"]');
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByRole("button", { name: "Agree and continue" }).click();
  // Audio-only studies (capture policy screen: off) have one "Allow and start" button.
  const allowAndStart = dialog.getByRole("button", { name: "Allow and start" });
  if (await allowAndStart.isVisible()) {
    await allowAndStart.click();
  } else {
    await dialog.getByRole("button", { name: "Allow" }).click();
    await expect(dialog.getByText("We can hear you")).toBeVisible({ timeout: 20_000 });
    await dialog.getByRole("button", { name: "Share and start" }).click();
  }
  await expect(dialog.getByText("Recording", { exact: true })).toBeVisible({ timeout: 60_000 });

  // "Use" the product while the fake microphone plays the sentence (it loops): draw a rectangle
  // and open help, so the app reports semantic events into the study session alongside the audio.
  await page.waitForTimeout(2_000);
  await page.mouse.click(400, 400);
  await page.keyboard.press("r");
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(600, 450, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  await page.keyboard.press("?");
  await page.waitForTimeout(800);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(12_000);

  await dialog.getByRole("button", { name: "Done" }).click();
  await dialog.getByText("How did it go?").waitFor({ timeout: 20_000 });
  await dialog.getByRole("button", { name: "Yes" }).click();
  await dialog.getByRole("button", { name: "2", exact: true }).click();
  await dialog.getByRole("button", { name: "Submit" }).click();
  await expect(dialog.getByText("Thank you")).toBeVisible({ timeout: 20_000 });
  expect(assignmentId).toBeTruthy();

  // Wait for the provider callback, then run the pipeline jobs inline (same code as the worker).
  type State = {
    completeness: string;
    transcript_status: string;
    events: number;
    semantic_events: number;
    assets: { status: string; provider_status: string | null; duration_ms: number | null }[];
    transcript: { start_ms: number; end_ms: number; text: string }[];
  };
  let state: State | null = null;
  const deadline = Date.now() + 4 * 60_000;
  while (Date.now() < deadline) {
    await ctx.request.post(`${APP}/api/dev/drain-jobs`);
    const res = await ctx.request.get(`${APP}/api/dev/session?assignment_id=${assignmentId}`);
    state = (await res.json()) as State;
    if (state.transcript_status === "done" || state.transcript_status === "failed") break;
    await page.waitForTimeout(5_000);
  }
  await browser.close();

  if (!state) throw new Error("no session state");
  expect(state.assets.length).toBeGreaterThanOrEqual(1);
  expect(state.assets[0]?.status).toBe("verified");
  expect(state.assets[0]?.duration_ms ?? 0).toBeGreaterThan(10_000);
  expect(state.completeness).toBe("complete");
  expect(state.events).toBeGreaterThan(0);
  // Instrumentation logs are the evidence next to the transcript: the drawing and help request.
  expect(state.semantic_events).toBeGreaterThan(0);
  expect(state.transcript_status).toBe("done");
  const text = state.transcript
    .map((t) => t.text)
    .join(" ")
    .toLowerCase();
  expect(text).toMatch(/export|image|drawing/);
  for (const seg of state.transcript) expect(seg.end_ms).toBeGreaterThanOrEqual(seg.start_ms);
});
