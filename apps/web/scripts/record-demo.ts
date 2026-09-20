import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";
import { sql } from "../src/db/client";
import { DEMO_PRODUCT_ID, resetDemoProduct } from "../src/db/demo-reset";

/**
 * Records the two-window demo as a narrated prototype video: the visitor on the instrumented
 * Excalidraw clone (left) and the owner's live analysis console (right), through the real
 * pipeline. The journey is a real Excalidraw friction: a user wants an image of their drawing,
 * "Share" opens live collaboration, "Save to…" writes a file nobody can open, help, then the
 * export hidden in the main menu. It runs twice: passively (Jev screening) and as an audio-only
 * study where the participant thinks out loud (a synthesized voice fed to the fake microphone).
 *
 * Needs: `pnpm dev` with DEMO_MODE=true, `pnpm tunnel` (Vonage callback), the Excalidraw clone on
 * :3200, real Jev/Vonage/SLNG keys, ffmpeg, and macOS `say` for the voices (scripts/voice).
 * Jobs are drained inline, so no worker is required. Output: demo-recordings/demo.mp4.
 */
const APP = process.env.DEMO_APP_URL ?? "http://localhost:3000";
const TARGET = process.env.DEMO_TARGET_URL ?? "http://localhost:3200/";
const OUT = path.resolve("demo-recordings");
const RAW = path.join(OUT, "raw");
const VOICE = path.join(OUT, "voice");
const SIZE = { width: 1280, height: 800 };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (m: string) =>
  process.stdout.write(`[demo ${new Date().toISOString().slice(11, 19)}] ${m}\n`);

async function drag(page: Page, tool: string, from: [number, number], to: [number, number]) {
  await page.keyboard.press(tool);
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 14 });
  await page.mouse.up();
}

/** Two boxes joined by an arrow: the task's diagram. */
async function drawShapes(page: Page, dy = 0) {
  await drag(page, "r", [300, 250 + dy], [480, 370 + dy]);
  await wait(700);
  await drag(page, "r", [620, 250 + dy], [800, 370 + dy]);
  await wait(700);
  await drag(page, "a", [485, 310 + dy], [615, 310 + dy]);
  await page.keyboard.press("Escape");
}

/** Detour 1: the top-right Share button opens live collaboration, not an export. */
async function shareDetour(page: Page, dwellMs = 2200) {
  await page.locator(".collab-button").first().click();
  await wait(dwellMs);
  await page.keyboard.press("Escape");
}

/** Detour 2: main menu → "Save to…" writes an .excalidraw file, not an image. */
async function saveToDetour(page: Page, dwellMs = 2400) {
  await page.getByTestId("main-menu-trigger").click();
  await wait(1200);
  await page.getByTestId("json-export-button").click();
  await wait(dwellMs);
  await page.keyboard.press("Escape");
}

async function askForHelp(page: Page, dwellMs = 2200) {
  await page.keyboard.press("?");
  await wait(dwellMs);
  await page.keyboard.press("Escape");
}

/** The real path: main menu → Export image… → background on, 2× → PNG. */
async function exportPng(page: Page) {
  await page.getByTestId("main-menu-trigger").click();
  await wait(1300);
  await page.getByTestId("image-export-button").click();
  await wait(1800);
  const background = page.locator('[name="exportBackgroundSwitch"]').first();
  if (await background.count()) {
    await background.click();
    await wait(900);
    await background.click();
    await wait(700);
  }
  const scale = page.getByText("2×", { exact: true }).first();
  if (await scale.count()) {
    await scale.click();
    await wait(800);
  }
  await page.getByRole("button", { name: /PNG/ }).first().click();
  await wait(1500);
  await page.keyboard.press("Escape");
}

async function main() {
  mkdirSync(RAW, { recursive: true });
  const participantVoice = path.join(VOICE, "participant.wav");
  if (!existsSync(participantVoice)) {
    const gen = spawnSync("bash", [path.resolve("scripts/voice/generate.sh")], {
      stdio: "inherit",
    });
    if (gen.status !== 0) throw new Error("voice generation failed");
  }
  await resetDemoProduct();
  log("database reset for the demo product");

  const browser = await chromium.launch({
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${participantVoice}`,
    ],
  });
  const record = { dir: RAW, size: SIZE };
  const owner = await browser.newContext({ viewport: SIZE, recordVideo: record });
  const visitor = await browser.newContext({ viewport: SIZE, recordVideo: record });
  await visitor.grantPermissions(["microphone"], { origin: APP });
  await visitor.grantPermissions(["microphone"], { origin: new URL(TARGET).origin });
  const ownerPage = await owner.newPage();
  const visitorPage = await visitor.newPage();
  const t0 = Date.now();
  const marks: Record<string, number> = {};
  const mark = (id: string) => {
    marks[id] = Date.now() - t0;
    log(`${id} at ${(marks[id] / 1000).toFixed(1)}s`);
  };

  // Owner: landing → demo sign-in → live console (waiting state).
  await ownerPage.goto(`${APP}/`);
  await ownerPage
    .getByRole("heading", { name: /already telling you/ })
    .waitFor({ timeout: 60_000 });
  mark("intro");
  await wait(4500);
  await ownerPage.goto(`${APP}/api/demo/enter?next=/products/${DEMO_PRODUCT_ID}/monitoring/live`);
  await ownerPage.getByText("Waiting for the first session").waitFor({ timeout: 30_000 });
  await wait(2500);

  // Visitor: the passive journey.
  await visitorPage.goto(TARGET, { waitUntil: "load" });
  await wait(2500);
  await drawShapes(visitorPage);
  await wait(1200);
  mark("detour");
  await shareDetour(visitorPage);
  await wait(1200);
  await saveToDetour(visitorPage);
  await wait(1200);
  await shareDetour(visitorPage, 1600);
  await wait(800);
  await askForHelp(visitorPage);
  await wait(1200);
  await exportPng(visitorPage);
  log("visitor: share, save-to, share, help, export done; waiting for the screening");
  const requestCtx = owner.request;
  for (let i = 0; i < 12; i += 1) {
    await requestCtx.post(`${APP}/api/dev/drain-jobs`).catch(() => null);
    await wait(1500);
  }
  mark("jev");
  await wait(7000);

  // Visitor: accepts the study toast and records with the microphone only.
  let assignmentId: string | null = null;
  visitorPage.on("response", async (r) => {
    if (r.url().endsWith("/api/embed/claim") && r.ok())
      assignmentId = ((await r.json()) as { assignment_id: string }).assignment_id;
  });
  await visitorPage.locator(".vc-toast").waitFor({ timeout: 20_000 });
  mark("study");
  await visitorPage.getByRole("button", { name: "See the task" }).click();
  const dialog = visitorPage.frameLocator('iframe[title="VibeCheck"]');
  await wait(2500);
  await dialog.getByRole("button", { name: "Continue" }).click();
  await wait(2500);
  await dialog.getByRole("button", { name: "Agree and continue" }).click();
  await wait(1500);
  await dialog.getByRole("button", { name: "Allow and start" }).click();
  await dialog.getByText("Recording", { exact: true }).waitFor({ timeout: 60_000 });
  mark("recording");
  // Paced to the participant's think-aloud (≈39 s): draw, share, save-to, share, help, export.
  await wait(1500);
  await drawShapes(visitorPage, 150);
  await wait(2500);
  await shareDetour(visitorPage, 2600);
  await wait(1000);
  await saveToDetour(visitorPage, 2600);
  await wait(800);
  await shareDetour(visitorPage, 1800);
  await wait(600);
  await askForHelp(visitorPage, 2600);
  await wait(800);
  await exportPng(visitorPage);
  await wait(3500);
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
  await wait(2500);
  mark("outro");
  await wait(9000);
  log("closing");

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

  // Side by side (visitor left, owner right) with the narrator clips and the participant's voice
  // placed where they happened. Timings come from the marks above, relative to the video start.
  const clips: { file: string; at: number; gain: number }[] = [
    { file: "narrator-intro.wav", at: marks.intro ?? 0, gain: 1 },
    { file: "narrator-detour.wav", at: marks.detour ?? 0, gain: 1 },
    { file: "narrator-jev.wav", at: marks.jev ?? 0, gain: 1 },
    { file: "narrator-study.wav", at: (marks.study ?? 0) + 500, gain: 1 },
    { file: "participant.wav", at: marks.recording ?? 0, gain: 0.85 },
    { file: "narrator-outro.wav", at: marks.outro ?? 0, gain: 1 },
  ].filter((c) => existsSync(path.join(VOICE, c.file)));
  const inputs = clips.flatMap((c) => ["-i", path.join(VOICE, c.file)]);
  const audioFilters = clips
    .map(
      (c, i) =>
        `[${i + 2}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${c.gain},adelay=${Math.round(c.at)}|${Math.round(c.at)}[a${i}]`,
    )
    .join(";");
  const mix = `${clips.map((_, i) => `[a${i}]`).join("")}amix=inputs=${clips.length}:normalize=0[a]`;
  const final = path.join(OUT, "demo.mp4");
  const ff = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      visitorOut,
      "-i",
      ownerOut,
      ...inputs,
      "-filter_complex",
      `[0:v][1:v]hstack=inputs=2[v];${audioFilters};${mix}`,
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-r",
      "25",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-crf",
      "20",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-shortest",
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
