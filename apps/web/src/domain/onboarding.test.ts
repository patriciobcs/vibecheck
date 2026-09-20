import { ProductConfigSchema } from "@vibecheck/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/db/client";
import { buildDiscoveryPrompt } from "@/providers/discovery/devin-prompt";
import { resetDb } from "@/test/db";
import { seedParticipant } from "@/test/fixtures";
import { createOwnerProduct, parseOnboardingForm } from "./onboarding";
import { createDiscoveryRun, productForTenant, setProductAppUrl } from "./products";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const minimal = { name: "Acme", repository_url: "https://github.com/acme/booking.git/" };
const appUrl = "https://app.example.com/start?preview=1";
const binding = { provider: "github", owner: "acme", repo: "booking", issues_enabled: false };
const publicResolver = async () => ["93.184.216.34"];

describe("minimal onboarding input", () => {
  it("accepts name and a repository without enabling collection or repository writes", () => {
    const result = parseOnboardingForm(form({ ...minimal, name: " Acme " }));
    expect(result.success).toBe(true);
    if (!result.success) throw result.error;
    expect(result.data).toMatchObject({
      ...minimal,
      url: null,
      schema_version: "2.0",
      permitted_origins: [],
      language: "en",
      description: "",
      audience: "",
      release_notes: [],
      support_complaints: [],
      known_journeys: [],
      product_events: [],
    });
    expect(result.data.repo_binding).toEqual(binding);
  });

  it("derives the app origin only when a live URL is provided", () => {
    const result = parseOnboardingForm(form({ ...minimal, url: appUrl }));
    expect(result.success).toBe(true);
    if (!result.success) throw result.error;
    expect(result.data.permitted_origins).toEqual(["https://app.example.com"]);
  });

  it.each([
    { ...minimal, name: "   " },
    { ...minimal, repository_url: "" },
    { ...minimal, repository_url: "not-a-url" },
    { ...minimal, repository_url: "https://example.com/acme/booking" },
    { ...minimal, repository_url: "https://github.com/acme/booking/tree/main" },
    { ...minimal, repository_url: "https://github.com/acme/booking?token=private" },
    { ...minimal, repository_url: "https://github.com/acme/.." },
    { ...minimal, repository_url: "https://github.com/acme/.git" },
    { ...minimal, repository_url: "https://github.com.evil.test/acme/booking" },
    { ...minimal, repository_url: "https://user:token@github.com/acme/booking" },
    { ...minimal, url: "not-a-url" },
    { ...minimal, url: "ftp://example.com" },
    { ...minimal, origins: "not-a-url" },
    { ...minimal, origins: "https://example.com/path" },
  ])("rejects invalid onboarding fields: %j", (values) => {
    expect(parseOnboardingForm(form(values)).success).toBe(false);
  });

  it("preserves optional context, explicit origins and imported sample provenance", () => {
    const result = parseOnboardingForm(
      form({
        ...minimal,
        description: " Book salon visits ",
        audience: "Salon customers",
        language: "fr",
        origins: "https://staging.example.com, https://app.example.com",
        release_notes: "Booking\n\nRescheduling",
        complaints: "Sample: the calendar was hard to find",
        journeys: "Book a visit\nCancel a booking",
        sample: "on",
      }),
    );
    expect(result.success).toBe(true);
    if (!result.success) throw result.error;
    expect(result.data).toMatchObject({
      description: "Book salon visits",
      audience: "Salon customers",
      language: "fr",
      permitted_origins: ["https://staging.example.com", "https://app.example.com"],
      release_notes: [
        { id: "release_0", text: "Booking", source: "owner import", isSample: true },
        { id: "release_1", text: "Rescheduling", source: "owner import", isSample: true },
      ],
      support_complaints: [{ id: "complaint_0", source: "owner import", isSample: true }],
      known_journeys: ["Book a visit", "Cancel a booking"],
    });
  });
});

describe("first project ownership", () => {
  beforeEach(resetDb);

  it("creates an owner workspace and persists the minimal form in one operation", async () => {
    const { userId } = await seedParticipant();
    const parsed = parseOnboardingForm(form(minimal));
    if (!parsed.success) throw parsed.error;
    const product = await createOwnerProduct(userId, parsed.data, undefined, publicResolver);
    const memberships = await db.query.memberships.findMany();
    expect(memberships).toMatchObject([{ userId, tenantId: product.tenantId, role: "owner" }]);
    expect(product).toMatchObject({
      name: "Acme",
      url: null,
      status: "needs_setup",
      setupError: "app_url_required",
      permittedOrigins: [],
      embedMode: "hosted",
      repoBinding: binding,
      releaseNotes: [],
    });
    expect(await productForTenant(product.tenantId, product.id)).toBeDefined();
    expect(await productForTenant("another-tenant", product.id)).toBeUndefined();
  });

  it("reuses one workspace under concurrent first-project submissions", async () => {
    const { userId } = await seedParticipant();
    const products = await Promise.all([
      createOwnerProduct(userId, minimal, undefined, publicResolver),
      createOwnerProduct(userId, { ...minimal, name: "Second" }, undefined, publicResolver),
    ]);
    expect(products[0]?.tenantId).toBe(products[1]?.tenantId);
    expect(await db.$count(schema.tenants)).toBe(1);
    expect(await db.$count(schema.memberships)).toBe(1);
  });

  it.each(["owner", "admin", "researcher"] as const)(
    "reuses an existing %s workspace",
    async (role) => {
      const { userId } = await seedParticipant();
      await db.insert(schema.tenants).values({ id: "existing", name: "Existing team" });
      await db
        .insert(schema.memberships)
        .values({ id: "member", tenantId: "existing", userId, role });
      const product = await createOwnerProduct(userId, minimal, undefined, publicResolver);
      expect(product.tenantId).toBe("existing");
      expect(await db.$count(schema.tenants)).toBe(1);
    },
  );

  it("does not elevate a viewer or create a replacement workspace", async () => {
    const { userId } = await seedParticipant();
    await db.insert(schema.tenants).values({ id: "existing", name: "Existing team" });
    await db.insert(schema.memberships).values({
      id: "member",
      tenantId: "existing",
      userId,
      role: "viewer",
    });
    await expect(
      createOwnerProduct(userId, minimal, undefined, publicResolver),
    ).rejects.toMatchObject({ status: 403 });
    expect(await db.$count(schema.products)).toBe(0);
    expect(await db.$count(schema.tenants)).toBe(1);
  });

  it("requires an authorized choice when the owner belongs to several workspaces", async () => {
    const { userId } = await seedParticipant();
    await db.insert(schema.tenants).values([
      { id: "first", name: "First" },
      { id: "second", name: "Second" },
      { id: "other", name: "Other" },
    ]);
    await db.insert(schema.memberships).values([
      { id: "one", tenantId: "first", userId, role: "owner" },
      { id: "two", tenantId: "second", userId, role: "researcher" },
    ]);
    await expect(
      createOwnerProduct(userId, minimal, undefined, publicResolver),
    ).rejects.toMatchObject({ code: "tenant_required" });
    await expect(
      createOwnerProduct(userId, minimal, "other", publicResolver),
    ).rejects.toMatchObject({ status: 403 });
    const product = await createOwnerProduct(userId, minimal, "second", publicResolver);
    expect(product.tenantId).toBe("second");
    expect(await db.$count(schema.products)).toBe(1);
  });

  it("does not create orphaned workspaces for invalid input or missing users", async () => {
    const { userId } = await seedParticipant();
    await expect(createOwnerProduct(userId, { name: "" })).rejects.toThrow();
    await expect(
      createOwnerProduct("missing-user", minimal, undefined, publicResolver),
    ).rejects.toMatchObject({ status: 401 });
    expect(await db.$count(schema.tenants)).toBe(0);
    expect(await db.$count(schema.memberships)).toBe(0);
  });

  it("retains destination protection for derived origins", async () => {
    const { userId } = await seedParticipant();
    const parsed = parseOnboardingForm(form({ ...minimal, url: appUrl }));
    if (!parsed.success) throw parsed.error;
    const product = await createOwnerProduct(userId, parsed.data, undefined, async () => [
      "10.0.0.1",
    ]);
    expect(product).toMatchObject({ status: "needs_setup", setupError: "destination_not_allowed" });
  });

  it("blocks research until an authorized owner adds a safe app URL", async () => {
    const { userId } = await seedParticipant();
    const parsed = parseOnboardingForm(form(minimal));
    if (!parsed.success) throw parsed.error;
    const product = await createOwnerProduct(userId, parsed.data);
    await expect(createDiscoveryRun(product.tenantId, product.id, "fixture")).rejects.toMatchObject(
      {
        status: 409,
        code: "app_url_required",
      },
    );
    expect(await db.$count(schema.jobs)).toBe(0);
    await expect(
      setProductAppUrl(userId, product.id, appUrl, async () => ["10.0.0.1"]),
    ).rejects.toMatchObject({
      code: "destination_not_allowed",
    });
    expect((await productForTenant(product.tenantId, product.id))?.url).toBeNull();
    await setProductAppUrl(userId, product.id, appUrl, publicResolver);
    expect(await productForTenant(product.tenantId, product.id)).toMatchObject({
      url: appUrl,
      status: "ready",
      setupError: null,
      permittedOrigins: ["https://app.example.com"],
      repoBinding: binding,
    });
    expect((await createDiscoveryRun(product.tenantId, product.id, "fixture"))?.status).toBe(
      "queued",
    );
    await expect(
      setProductAppUrl(userId, product.id, "https://different.example.com", publicResolver),
    ).rejects.toMatchObject({
      code: "app_url_already_set",
    });
  });

  it("does not let another user or a viewer configure the research URL", async () => {
    const { userId } = await seedParticipant();
    const { userId: other } = await seedParticipant();
    const product = await createOwnerProduct(userId, minimal);
    await expect(setProductAppUrl(other, product.id, appUrl, publicResolver)).rejects.toMatchObject(
      { status: 403 },
    );
    await db.insert(schema.memberships).values({
      id: "viewer-member",
      tenantId: product.tenantId,
      userId: other,
      role: "viewer",
    });
    await expect(setProductAppUrl(other, product.id, appUrl, publicResolver)).rejects.toMatchObject(
      { status: 403 },
    );
    expect((await productForTenant(product.tenantId, product.id))?.url).toBeNull();
  });
});

describe("discovery with minimal context", () => {
  it("allows exploratory research without pretending release notes or complaints exist", () => {
    const prompt = buildDiscoveryPrompt(
      {
        ...ProductConfigSchema.parse({ ...minimal, url: appUrl }),
        sourceRevision: "revision",
      },
      "run",
    );
    expect(prompt).toContain("No release notes were supplied. Inspect the app URL");
    expect(prompt).toContain("Do not invent traffic, complaints or observed failures");
    expect(prompt).toContain("If no registered success and eligibility rules fit");
    expect(prompt).toContain("cannot_assess");
    expect(prompt).not.toContain("Prioritize the recently shipped features");
  });

  it("still prioritizes explicit release context and preserves sample labeling instructions", () => {
    const prompt = buildDiscoveryPrompt(
      {
        ...ProductConfigSchema.parse({
          ...minimal,
          release_notes: [
            { id: "release", text: "Booking", source: "owner import", isSample: true },
          ],
        }),
        sourceRevision: "revision",
      },
      "run",
    );
    expect(prompt).toContain("Prioritize the recently shipped features listed in release notes");
    expect(prompt).toContain("Items marked isSample:true are sample data");
    expect(prompt).not.toContain("No release notes were supplied");
  });
});
