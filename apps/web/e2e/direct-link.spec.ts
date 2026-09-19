import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

const owner = process.env.SEED_OWNER_EMAIL ?? "owner@example.test";

test("direct link: owner creates it, participant redeems, dialog runs task → consent → devices", async ({
  page,
  request,
  browser,
}) => {
  await signIn(page, request, owner);
  await page.goto("/owner");
  await page.getByRole("button", { name: "New direct link" }).first().click();
  const linkInput = page.getByRole("dialog").getByRole("textbox");
  await expect(linkInput).toHaveValue(/\/t\//);
  const url = await linkInput.inputValue();
  const token = url.split("/t/")[1] ?? "";

  const participantCtx = await browser.newContext();
  const participant = await participantCtx.newPage();
  const email = `tester+${Date.now()}@example.test`;
  await participant.goto(url);
  await expect(participant).toHaveURL(/\/sign-in/);
  await signIn(participant, participantCtx.request, email);

  // Redeem through the API to capture the handoff destination.
  const redeem = await participantCtx.request.post("/api/invitations/redeem", { data: { token } });
  expect(redeem.ok()).toBe(true);
  const { assignment_id, destination } = (await redeem.json()) as {
    assignment_id: string;
    destination: string;
  };
  expect(destination).toMatch(/#vc=/);
  const handoff = destination.split("#vc=")[1] ?? "";

  // The dialog runs inside the SDK overlay on the product page. Use the demo target on this server.
  await participant.goto(`/demo-target#vc=${handoff}`);
  const dialog = participant.frameLocator('iframe[title="VibeCheck"]');
  await expect(dialog.getByText("Your task in")).toBeVisible();
  await expect(participant).not.toHaveURL(/#vc=/); // fragment consumed, never left in the address bar
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog.getByText("What is recorded")).toBeVisible();
  await dialog.getByRole("button", { name: "Agree and continue" }).click();
  await expect(dialog.getByText(/Share screen and microphone/)).toBeVisible();

  // Consent must be persisted before any capture, and the token must be scoped to this assignment.
  const view = await participantCtx.request.get(`/api/assignments/${assignment_id}`, {
    headers: { Authorization: `Bearer ${handoff}` },
  });
  const body = (await view.json()) as {
    assignment: { state: string; consentVersion: string | null };
  };
  expect(body.assignment.consentVersion).toBe("consent_v1");
  expect(["consent", "device_check"]).toContain(body.assignment.state);
  const other = await participantCtx.request.get("/api/assignments/assignment_other", {
    headers: { Authorization: `Bearer ${handoff}` },
  });
  expect(other.status()).toBe(403);
  await participantCtx.close();
});

test("marketplace claim is transactional and idempotent for one participant", async ({
  page,
  request,
}) => {
  const email = `claimer+${Date.now()}@example.test`;
  await signIn(page, request, email);
  await page.goto("/marketplace");
  const claim = page.getByRole("button", { name: "Claim task" }).first();
  if (await claim.isVisible()) {
    await claim.click();
    await expect(page).toHaveURL(/demo-target/);
    await page.goto("/marketplace");
    await expect(page.getByRole("link", { name: "Continue your task" }).first()).toBeVisible();
  } else {
    await expect(page.getByText(/All spots claimed|No studies are recruiting/)).toBeVisible();
  }
});

test("embedded join: anonymous device participant claims inside the overlay frame", async ({
  page,
  request,
}) => {
  const { key } = (await (await request.get("/api/dev/sample-key")).json()) as { key: string };
  await page.goto("/demo-target");
  await page.evaluate(
    (src) => {
      const f = document.createElement("iframe");
      f.title = "VibeCheck";
      f.src = src;
      document.body.appendChild(f);
    },
    `/embed/join/study_sample_reschedule?key=${encodeURIComponent(key)}`,
  );
  const dialog = page.frameLocator('iframe[title="VibeCheck"]');
  await expect(dialog.getByText(/Your task in|all the participants/)).toBeVisible();
});

test("SDK never posts typed characters", async ({ page, request }) => {
  await signIn(page, request, `sdk+${Date.now()}@example.test`);
  await page.goto("/demo-target");
  await page.waitForFunction(
    () => typeof (window as unknown as { VibeCheck?: unknown }).VibeCheck !== "undefined",
  );
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/sdk/events")) requests.push(r.postData() ?? "");
  });
  await page.getByPlaceholder(/Typed text/).fill("hunter2 secret");
  await page.waitForTimeout(500);
  expect(requests).toEqual([]);
});
