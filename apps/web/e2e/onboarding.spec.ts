import { expect, test } from "@playwright/test";

test("a new founder saves a GitHub project and adds the live app later", async ({
  page,
  request,
}) => {
  const email = `founder-${Date.now()}@example.test`;
  await page.goto("/");
  await page.getByRole("link", { name: "Add your project", exact: true }).first().click();
  await expect(page).toHaveURL(/\/sign-in\?next=\/products\/new/);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await expect(page.getByText("Step 1 of 2 · Sign in")).toBeVisible();
  await page.getByRole("button", { name: "Create local sign-in link" }).click();
  await expect(page.getByText("Your local sign-in link is ready")).toBeVisible();
  const response = await request.get(`/api/dev/magic-link?email=${encodeURIComponent(email)}`);
  expect(response.ok()).toBe(true);
  const { url } = (await response.json()) as { url: string };
  await page.goto(url);
  await expect(page).toHaveURL(/\/products\/new$/);
  await expect(page.getByText(`Signed in as ${email}.`)).toBeVisible();
  await page.goto("/sign-in?next=/products/new");
  await expect(page).toHaveURL(/\/products\/new$/);

  await expect(page.getByLabel("Description", { exact: true })).toBeHidden();
  await expect(page.locator("input:visible")).toHaveCount(2);
  await page.getByLabel("Project name").fill("   ");
  await page.getByLabel("GitHub repository URL").fill("https://github.com/acme/booking.git");
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  await expect(page.getByText("Enter a project name.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("GitHub repository URL")).toHaveValue(
    "https://github.com/acme/booking.git",
  );
  await page.getByLabel("Project name").fill("Founder's first project");
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  await expect(page).toHaveURL(/\/products\/product_/);
  await expect(page.getByRole("heading", { name: "Founder's first project" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run discovery" })).toBeDisabled();
  await expect(
    page.getByText(
      "Repository link saved. GitHub access is not verified; issues and code changes are off.",
    ),
  ).toBeVisible();

  const productId = page.url().split("/products/")[1];
  const productResponse = await page.request.get(`/api/products/${productId}`);
  expect(productResponse.ok()).toBe(true);
  const product = await productResponse.json();
  expect(product).toMatchObject({
    name: "Founder's first project",
    schema_version: "2.0",
    url: null,
    status: "needs_setup",
    permittedOrigins: [],
    language: "en",
    embedMode: "hosted",
    repoBinding: { provider: "github", owner: "acme", repo: "booking", issues_enabled: false },
    releaseNotes: [],
    supportComplaints: [],
    discoveryRuns: [],
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Founder's first project" })).toBeVisible();
  await page
    .getByLabel("Live app URL", { exact: true })
    .fill("https://example.com/start?preview=1");
  await page.getByRole("button", { name: "Save app URL" }).click();
  await expect(page.getByRole("button", { name: "Run discovery" })).toBeEnabled();
  const configured = await page.request.get(`/api/products/${productId}`);
  expect(await configured.json()).toMatchObject({
    url: "https://example.com/start?preview=1",
    status: "ready",
    permittedOrigins: ["https://example.com"],
  });
});
