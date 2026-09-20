import type { APIRequestContext, Page } from "@playwright/test";

/** Signs in through the real magic-link flow, reading the link from the dev test inbox. */
export async function signIn(page: Page, request: APIRequestContext, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await page.getByText("Check your inbox").waitFor();
  const res = await request.get(`/api/dev/magic-link?email=${encodeURIComponent(email)}`);
  const { url } = (await res.json()) as { url: string };
  await page.goto(url);
  await page.waitForURL((u) => !u.pathname.includes("magic-link"));
}
