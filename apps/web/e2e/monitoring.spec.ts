import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

const owner = process.env.SEED_OWNER_EMAIL ?? "owner@example.test";
const APP = process.env.E2E_BASE_URL ?? "http://localhost:3100";

const questions = {
  evidence_sufficiency: {
    type: "choice",
    instructions: "Enough context?",
    criteria: { sufficient: "a", partial: "b", insufficient: "c" },
  },
  ux_friction_observed: {
    type: "noul",
    instructions: "Difficulty?",
    criteria: { true: "x", false: "y" },
  },
  targeted_research_warranted: { type: "noul", instructions: "Study?" },
  problem_category: {
    type: "choice",
    instructions: "Category",
    criteria: { discoverability: "a", other_or_uncertain: "b" },
  },
};

test("passive signal → Jev screening → candidate → task proposal, with collection off by default", async ({
  page,
  request,
}) => {
  await signIn(page, request, owner);
  const products = (await (await page.request.get("/api/products")).json()) as {
    id: string;
    publishableKey: string;
    url: string;
  }[];
  const product = products.find((p) => p.id === "product_sample_booking");
  if (!product) throw new Error("sample product missing");
  const origin = new URL(product.url).origin;

  // Start from the default (disabled) policy regardless of what earlier runs left behind.
  await page.request.put(`/api/owner/products/${product.id}/monitoring`, {
    data: { enabled: false },
  });

  // Collection is off by default: opening an observation session is refused.
  const refused = await request.post(`${APP}/api/observe/session`, {
    headers: { Origin: origin },
    data: {
      publishable_key: product.publishableKey,
      build_ref: "b1",
      collection_permission: "granted",
    },
  });
  expect(refused.status()).toBe(409);

  // Owner enables monitoring for one journey and publishes a manual detector.
  const put = await page.request.put(`/api/owner/products/${product.id}/monitoring`, {
    data: { enabled: true, allowed_journeys: ["reschedule"], batch_delay_ms: 0, cooldown_ms: 0 },
  });
  expect(put.ok()).toBe(true);
  const det = await page.request.post(`/api/owner/products/${product.id}/detectors`, {
    data: {
      mode: "manual",
      detector_id: "reschedule_e2e",
      journey_id: "reschedule",
      app_build_ref: "b1",
      required_events: ["journey_start", "help_request"],
      questions,
    },
  });
  expect(det.status()).toBe(201);
  const detectorRef = `reschedule_e2e:${((await det.json()) as { version: number }).version}`;

  // Permission still gates collection; then a help journey arrives from the product origin.
  const noPerm = await request.post(`${APP}/api/observe/session`, {
    headers: { Origin: origin },
    data: {
      publishable_key: product.publishableKey,
      build_ref: "b1",
      collection_permission: "unknown",
    },
  });
  expect(noPerm.status()).toBe(409);
  const opened = await request.post(`${APP}/api/observe/session`, {
    headers: { Origin: origin },
    data: {
      publishable_key: product.publishableKey,
      build_ref: "b1",
      collection_permission: "granted",
    },
  });
  expect(opened.ok()).toBe(true);
  const { session_id, token } = (await opened.json()) as { session_id: string; token: string };
  const ev = (sequence: number, type: string, extra: Record<string, unknown> = {}) => ({
    event_id: `e2e_${session_id}_${sequence}`,
    observation_session_id: session_id,
    journey_instance_id: `journey_${session_id}`,
    journey_id: "reschedule",
    sequence,
    t_ms: sequence * 1000,
    build_ref: "b1",
    instrumentation_schema_version: "1.0",
    collection_policy_ref: "cp",
    type,
    goal_source: "declared",
    ...extra,
  });
  const batch = {
    observation_session_id: session_id,
    batch_id: `b_${session_id}`,
    events: [ev(0, "journey_start"), ev(1, "help_request", { target_ref: "help" })],
  };
  const headers = {
    Origin: origin,
    Authorization: `Bearer ${token}`,
    "X-VibeCheck-Key": product.publishableKey,
  };
  const bad = await request.post(`${APP}/api/observe/events`, {
    headers,
    data: { ...batch, events: [{ ...batch.events[0], text: "secret" }] },
  });
  expect(bad.status()).toBe(400);
  const ok = await request.post(`${APP}/api/observe/events`, { headers, data: batch });
  expect(ok.ok()).toBe(true);
  const dup = await request.post(`${APP}/api/observe/events`, { headers, data: batch });
  expect(((await dup.json()) as { duplicate: boolean }).duplicate).toBe(true);

  // The scan runs as a job; the evaluation is answered by a stub so no provider is needed here
  // (only scans are drained, so a configured JEV_API_KEY never turns this into a billed call).
  await request.post(`${APP}/api/dev/drain-jobs`, { data: { types: ["monitoring.scan"] } });
  let state = (await (
    await request.get(`${APP}/api/dev/monitoring?product_id=${product.id}`)
  ).json()) as {
    evaluations: { status: string; triggerReason: string; detectorRef: string }[];
    candidates: { id: string; state: string; category: string; detectorRef: string }[];
  };
  expect(state.evaluations.map((e) => [e.status, e.triggerReason])).toContainEqual([
    "queued",
    "help_request",
  ]);
  await request.post(`${APP}/api/dev/monitoring`, {
    data: {
      product_id: product.id,
      answers: {
        evidence_sufficiency: {
          type: "choice",
          choice: "partial",
          confidence: 0.7,
          probabilities: { partial: 0.7, sufficient: 0.2, insufficient: 0.1 },
        },
        ux_friction_observed: { type: "noul", noul: 0.92 },
        targeted_research_warranted: { type: "noul", noul: 0.86 },
        problem_category: {
          type: "choice",
          choice: "discoverability",
          confidence: 0.8,
          probabilities: { discoverability: 0.8, other_or_uncertain: 0.2 },
        },
      },
    },
  });
  state = (await (
    await request.get(`${APP}/api/dev/monitoring?product_id=${product.id}`)
  ).json()) as typeof state;
  expect(state.evaluations.find((e) => e.detectorRef === detectorRef)?.status).toBe("completed");
  const proposed = state.candidates.filter(
    (c) => c.state === "proposed" && c.detectorRef === detectorRef,
  );
  expect(proposed).toHaveLength(1);
  expect(proposed[0]).toMatchObject({ category: "discoverability" });

  // The live board lists the session and shows the completed evaluation with its answers.
  await page.goto(`/products/${product.id}/monitoring/live`);
  await expect(page.getByRole("heading", { name: "Live analysis" })).toBeVisible();
  // Sessions render as tabs or, past six, as a dropdown; the count line is present either way.
  await expect(page.getByText(/^\d+ sessions?$/)).toBeVisible();
  await expect(page.getByText("jev-stub").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Friction observed").first()).toBeVisible();

  // The Monitoring view shows the candidate as a signal, and the owner asks discovery for a neutral task.
  await page.goto(`/products/${product.id}/monitoring`);
  await expect(page.getByRole("heading", { name: "Monitoring" })).toBeVisible();
  await expect(page.getByText("reschedule · discoverability").first()).toBeVisible();
  await page.getByRole("button", { name: "Request task proposal" }).first().click();
  await expect(page.getByText("Discovery run queued")).toBeVisible();
  await request.post(`${APP}/api/dev/drain-jobs`, { data: { types: ["discovery.run"] } });
  await page.goto(`/products/${product.id}`);
  await expect(page.getByText("From passive signal").first()).toBeVisible({ timeout: 15_000 });
  const cand = proposed[0]?.id ?? "";
  const dismissed = await page.request.post(`/api/owner/candidates/${cand}`, {
    data: { action: "dismiss", reason: "e2e cleanup" },
  });
  expect(dismissed.ok()).toBe(true);
  await page.request.put(`/api/owner/products/${product.id}/monitoring`, {
    data: { enabled: false },
  });
});
