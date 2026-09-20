import { spawnSync } from "node:child_process";
import { mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db, schema, sql } from "../src/db/client";

/**
 * Records the two-window demo as a prototype video: the visitor on the instrumented Excalidraw
 * clone (left) and the owner's live analysis board (right), driven through the real pipeline:
 * passive events → Jev screening, then an audio-only study with a fake microphone → transcript.
 *
 * Needs: `pnpm dev` with DEMO_MODE=true, `pnpm tunnel` (Vonage callback), the Excalidraw clone on
 * :3200, real Jev/Vonage/SLNG keys, and ffmpeg for the side-by-side composition. Jobs are drained
 * inline, so no worker is required. Output: demo-recordings/demo.mp4 (plus the raw halves).
 */
const APP = process.env.DEMO_APP_URL ?? "http://localhost:3000";
const TARGET = process.env.DEMO_TARGET_URL ?? "http://localhost:3200/";
const PRODUCT_ID = "product_excalidraw_local";
const STUDY_ID = "study_excalidraw_export";
const OUT = path.resolve("demo-recordings");
const RAW = path.join(OUT, "raw");
const SPEECH = path.resolve("e2e/fixtures/speech.wav");
const SIZE = { width: 1280, height: 800 };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (m: string) =>
  process.stdout.write(`[demo ${new Date().toISOString().slice(11, 19)}] ${m}\n`);

/** Start from a clean slate for this product: no earlier visitors or participants on the board. */
async function resetDemoProduct() {
  await db
    .delete(schema.observationSessions)
    .where(eq(schema.observationSessions.productId, PRODUCT_ID));
  await db.delete(schema.assignments).where(eq(schema.assignments.studyId, STUDY_ID));
  await db
    .delete(schema.researchCandidates)
    .where(eq(schema.researchCandidates.productId, PRODUCT_ID));
}

async function drag(page: Page, tool: string, from: [number, number], to: [number, number]) {
  await page.keyboard.press(tool);
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 12 });
  await page.mouse.up();
}

/** Two boxes joined by an arrow: the task's diagram. */
async function drawShapes(page: Page, dy = 0) {
  await drag(page, "r", [300, 260 + dy], [480, 380 + dy]);
  await wait(600);
  await drag(page, "r", [620, 260 + dy], [800, 380 + dy]);
  await wait(600);
  await drag(page, "a", [485, 320 + dy], [615, 320 + dy]);
  await page.keyboard.press("Escape");
}

/** The top-right Share button opens live collaboration, not an export: a detour, then closed. */
async function openShareAndClose(page: Page) {
  await page.locator(".collab-button").first().click();
  await wait(2200);
  await page.keyboard.press("Escape");
}

/** The real path: main menu → Export image… → PNG. */
async function exportPng(page: Page) {
  await page.getByTestId("main-menu-trigger").click();
  await wait(1500);
  await page.getByTestId("image-export-button").click();
  await wait(2000);
  await page.getByRole("button", { name: /PNG/ }).first().click();
  await wait(1500);
  await page.keyboard.press("Escape");
}

async function main() {
  mkdirSync(RAW, { recursive: true });
  await resetDemoProduct();
  log("database reset for the demo product");

  const browser = await chromium.launch({
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${SPEECH}`,
    ],
  });
  const record = { dir: RAW, size: SIZE };
  const owner = await browser.newContext({ viewport: SIZE, recordVideo: record });
  const visitor = await browser.newContext({ viewport: SIZE, recordVideo: record });
  await visitor.grantPermissions(["microphone"], { origin: APP });
  await visitor.grantPermissions(["microphone"], { origin: new URL(TARGET).origin });
  const ownerPage = await owner.newPage();
  const visitorPage = await visitor.newPage();

  // Owner: landing → demo sign-in → live board (waiting state).
  await ownerPage.goto(`${APP}/`);
  await ownerPage.getByRole("heading", { name: /Find the friction/ }).waitFor({ timeout: 60_000 });
  await wait(3000);
  await ownerPage.goto(`${APP}/api/demo/enter?next=/products/${PRODUCT_ID}/monitoring/live`);
  await ownerPage.getByText("Waiting for the first session").waitFor({ timeout: 30_000 });
  log("owner on the live board");
  await wait(2000);

  // Visitor: draws two boxes and an arrow, wants an image of it. Tries "Share" twice (live
  // collaboration, a detour), asks for help, then finds Export in the main menu → passive screening.
  await visitorPage.goto(TARGET, { waitUntil: "load" });
  await wait(3000);
  await drawShapes(visitorPage);
  await wait(1500);
  await openShareAndClose(visitorPage);
  await wait(1500);
  await openShareAndClose(visitorPage);
  await wait(1000);
  await visitorPage.keyboard.press("?");
  await wait(2000);
  await visitorPage.keyboard.press("Escape");
  await wait(1500);
  await exportPng(visitorPage);
  log("visitor detoured through Share, asked for help, then exported; waiting for the screening");
  const requestCtx = owner.request;
  for (let i = 0; i < 14; i += 1) {
    await requestCtx.post(`${APP}/api/dev/drain-jobs`).catch(() => null);
    await wait(1500);
  }
  await wait(2000);

  // Visitor: accepts the study toast and records with the microphone only.
  let assignmentId: string | null = null;
  visitorPage.on("response", async (r) => {
    if (r.url().endsWith("/api/embed/claim") && r.ok())
      assignmentId = ((await r.json()) as { assignment_id: string }).assignment_id;
  });
  await visitorPage.locator(".vc-toast").waitFor({ timeout: 20_000 });
  await visitorPage.getByRole("button", { name: "See the task" }).click();
  const dialog = visitorPage.frameLocator('iframe[title="VibeCheck"]');
  await wait(2500);
  await dialog.getByRole("button", { name: "Continue" }).click();
  await wait(2500);
  await dialog.getByRole("button", { name: "Agree and continue" }).click();
  await wait(1500);
  await dialog.getByRole("button", { name: "Allow and start" }).click();
  await dialog.getByText("Recording", { exact: true }).waitFor({ timeout: 60_000 });
  log("study recording started");
  await wait(2000);
  await visitorPage.keyboard.press("Meta+a");
  await visitorPage.keyboard.press("Delete");
  await wait(800);
  await drawShapes(visitorPage, 120);
  await wait(1500);
  await openShareAndClose(visitorPage);
  await wait(3000);
  await exportPng(visitorPage);
  await wait(6000);
  await dialog.getByRole("button", { name: "Done" }).click();
  await dialog.getByText("How did it go?").waitFor({ timeout: 20_000 });
  await wait(1500);
  await dialog.getByRole("button", { name: "Yes" }).click();
  await dialog.getByRole("button", { name: "2", exact: true }).click();
  await wait(800);
  await dialog.getByRole("button", { name: "Submit" }).click();
  await dialog.getByText("Thank you").waitFor({ timeout: 20_000 });
  log("study finished; waiting for the upload and transcript");

  // Pipeline: archive callback → fetch → transcript, drained inline (no worker needed).
  const deadline = Date.now() + 4 * 60_000;
  while (Date.now() < deadline) {
    await requestCtx.post(`${APP}/api/dev/drain-jobs`).catch(() => null);
    if (assignmentId) {
      const res = await requestCtx.get(`${APP}/api/dev/session?assignment_id=${assignmentId}`);
      const state = (await res.json()) as { transcript_status: string };
      if (state.transcript_status === "done" || state.transcript_status === "failed") break;
    }
    await wait(4000);
  }
  await wait(6000);
  log("transcript on the board; closing");

  const ownerVideo = await ownerPage.video()?.path();
  const visitorVideo = await visitorPage.video()?.path();
  await owner.close();
  await visitor.close();
  await browser.close();
  await sql.end();
  if (!ownerVideo || !visitorVideo) throw new Error("no video recorded");
  const ownerOut = path.join(OUT, "owner.webm");
  const visitorOut = path.join(OUT, "visitor.webm");
  renameSync(ownerVideo, ownerOut);
  renameSync(visitorVideo, visitorOut);

  // Side by side: visitor left, owner right.
  const final = path.join(OUT, "demo.mp4");
  const ff = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      visitorOut,
      "-i",
      ownerOut,
      "-filter_complex",
      "[0:v][1:v]hstack=inputs=2[v]",
      "-map",
      "[v]",
      "-r",
      "25",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-crf",
      "20",
      final,
    ],
    { stdio: "inherit" },
  );
  if (ff.status !== 0) throw new Error("ffmpeg failed");
  log(`done: ${final}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
