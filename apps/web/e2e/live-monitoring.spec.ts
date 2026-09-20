import { chromium, expect, test } from "@playwright/test";

/**
 * Real-provider screening on the instrumented Excalidraw clone: draw, open help, let the worker
 * scan and Jev evaluate. Opt in with LIVE_PROVIDERS=1, JEV_API_KEY set, `pnpm dev`, `pnpm worker`
 * and Excalidraw (:3200) running. Asserts a completed evaluation with a returned model and valid answers.
 */
const LIVE = process.env.LIVE_PROVIDERS === "1";
const APP = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const TARGET = process.env.LIVE_TARGET_URL ?? "http://localhost:3200/";

test.skip(!LIVE, "set LIVE_PROVIDERS=1 to run against real providers");
test.setTimeout(4 * 60_000);

test("a help request on Excalidraw is screened by Jev and recorded with model, usage and answers", async ({
  request,
}) => {
  const health = (await (await request.get(`${APP}/api/health`)).json()) as {
    providers: { jev: boolean };
  };
  test.skip(!health.providers.jev, "JEV_API_KEY is not configured on the server");

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  if (APP !== "http://localhost:3000") {
    await page.route("http://localhost:3000/**", (route) =>
      route.continue({ url: route.request().url().replace("http://localhost:3000", APP) }),
    );
  }
  const observe: number[] = [];
  page.on("response", (r) => {
    if (r.url().includes("/api/observe/events")) observe.push(r.status());
  });
  await page.goto(TARGET, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  await page.keyboard.press("r");
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(600, 450, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  await page.keyboard.press("?");
  await page.waitForTimeout(1200);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(6000);
  await browser.close();
  expect(observe).toContain(200);

  type Evaluation = {
    status: string;
    triggerReason: string;
    returnedModel: string | null;
    inputTokens: number | null;
    statusReason: string | null;
    answers: Record<string, { type: string; noul?: number; choice?: string }> | null;
  };
  let done: Evaluation | undefined;
  const deadline = Date.now() + 3 * 60_000;
  while (Date.now() < deadline) {
    const o = (await (
      await request.get(`${APP}/api/dev/monitoring?product_id=product_excalidraw_local`)
    ).json()) as { evaluations: Evaluation[] };
    done = o.evaluations.find(
      (e) =>
        e.triggerReason === "help_request" &&
        (e.status === "completed" || e.status === "failed" || e.status === "unknown_outcome"),
    );
    if (done) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (!done) throw new Error("no evaluation reached a terminal state in time");
  expect(done.status, done.statusReason ?? "").toBe("completed");
  expect(done.returnedModel).toMatch(/jev/);
  expect(done.inputTokens ?? 0).toBeGreaterThan(0);
  const a = done.answers ?? {};
  expect(a.ux_friction_observed?.type).toBe("noul");
  expect(a.ux_friction_observed?.noul).toBeGreaterThanOrEqual(0);
  expect(["sufficient", "partial", "insufficient"]).toContain(a.evidence_sufficiency?.choice);
});
