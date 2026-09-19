import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

const owner = process.env.SEED_OWNER_EMAIL ?? "owner@example.test";

test("VC-01: connect a product, run fixture discovery, publish one proposal, hand off to VC-02", async ({
  page,
  request,
}) => {
  await signIn(page, request, owner);

  // Connect a product with labeled sample material.
  await page.goto("/products/new");
  await page.getByLabel("Name").fill(`E2E Product ${Date.now()}`);
  await page.getByLabel("URL").fill("http://localhost:3200/");
  await page.getByLabel("Release notes").fill("Sticky notes\nBucket fill");
  await page.getByLabel("Support complaints").fill("Sample complaint: could not find export");
  await page.getByLabel("Mark imported items as sample data").click();
  await page.getByRole("button", { name: "Connect product" }).click();
  await expect(page).toHaveURL(/\/products\/product_/);
  await expect(page.getByRole("heading", { name: /E2E Product/ })).toBeVisible();
  await expect(page.getByText("Needs setup")).toHaveCount(0);
  const productUrl = page.url();

  // Run discovery with the fixture provider; the worker job is drained inline.
  await page.getByRole("button", { name: "Run discovery" }).click();
  await expect(page.getByText(/Queued|Inspecting/)).toBeVisible();
  const drained = await request.post("/api/dev/drain-jobs");
  expect(drained.ok()).toBe(true);
  await page.goto(productUrl);
  await expect(page.getByText("Proposed", { exact: true })).toBeVisible();
  await expect(page.getByText("Sample data").first()).toBeVisible();
  const publishLinks = page.getByRole("link", { name: "Publish study" });
  expect(await publishLinks.count()).toBeGreaterThan(0);

  // Publish the first proposal.
  await publishLinks.first().click();
  await expect(page.getByRole("heading", { name: "Publish study" })).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page).toHaveURL(/\/studies\/study_/);
  await expect(page.getByText("study.published event")).toBeVisible();
  await expect(page.getByText('"event_type": "study.published"')).toBeVisible();
  await expect(page.getByText('"schema_version": "1.0"').first()).toBeVisible();

  // The published study is claimable through the VC-02 API (same plan contract).
  const studyId = page.url().split("/studies/")[1] ?? "";
  const res = await page.request.get(`/api/studies/${studyId}`); // shares the signed-in cookies
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as {
    status: string;
    revisions: { provenance: string; plan: { task: { task_id: string } } }[];
  };
  expect(body.status).toBe("published");
  expect(body.revisions[0]?.provenance).toBe("vc01");
  expect(body.revisions[0]?.plan.task.task_id).toBe("task_capture_ideas");
});

test("VC-01 API: a second tenant cannot read the product", async ({ request }) => {
  const key = process.env.DEV_API_KEY ?? "dev_local_key_1";
  const list = await request.get("/api/products", { headers: { authorization: `Bearer ${key}` } });
  expect(list.ok()).toBe(true);
  const products = (await list.json()) as { id: string }[];
  expect(products.length).toBeGreaterThan(0);
  const unauth = await request.get(`/api/products/${products[0]?.id}`, {
    headers: { authorization: "Bearer not-a-key" },
  });
  expect(unauth.status()).toBe(401);
});
