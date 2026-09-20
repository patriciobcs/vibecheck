import { expect, test } from "@playwright/test";

test("a new founder can add a project from the landing page with only name and URL", async ({
  page,
  request,
}) => {
  const email = `founder-${Date.now()}@example.test`;
  await page.goto("/");
  await page.getByRole("link", { name: "Add your project", exact: true }).first().click();
  await expect(page).toHaveURL(/\/sign-in\?next=\/products\/new/);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.getByText("Check your inbox")).toBeVisible();
  const response = await request.get(`/api/dev/magic-link?email=${encodeURIComponent(email)}`);
  expect(response.ok()).toBe(true);
  const { url } = (await response.json()) as { url: string };
  await page.goto(url);
  await expect(page).toHaveURL(/\/products\/new$/);

  await expect(page.getByLabel("Description", { exact: true })).toBeHidden();
  await expect(page.locator("input:visible")).toHaveCount(2);
  await page.getByLabel("Project name").fill("   ");
  await page.getByLabel("App URL").fill("https://example.com/start?preview=1");
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Enter a project name.");
  await expect(page.getByLabel("App URL")).toHaveValue("https://example.com/start?preview=1");
  await page.getByLabel("Project name").fill("Founder's first project");
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  await expect(page).toHaveURL(/\/products\/product_/);
  await expect(page.getByRole("heading", { name: "Founder's first project" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run discovery" })).toBeVisible();

  const productId = page.url().split("/products/")[1];
  const productResponse = await page.request.get(`/api/products/${productId}`);
  expect(productResponse.ok()).toBe(true);
  const product = await productResponse.json();
  expect(product).toMatchObject({
    name: "Founder's first project",
    permittedOrigins: ["https://example.com"],
    language: "en",
    embedMode: "hosted",
    repoBinding: null,
    releaseNotes: [],
    supportComplaints: [],
    discoveryRuns: [],
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Founder's first project" })).toBeVisible();
});
