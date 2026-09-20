import { ProductConfigSchema } from "@vibecheck/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/db/client";
import { buildDiscoveryPrompt } from "@/providers/discovery/devin-prompt";
import { resetDb } from "@/test/db";
import { seedParticipant } from "@/test/fixtures";
import { createOwnerProduct, parseOnboardingForm } from "./onboarding";
import { productForTenant } from "./products";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const minimal = { name: "Acme", url: "https://app.example.com/start?preview=1" };
const publicResolver = async () => ["93.184.216.34"];

describe("minimal onboarding input", () => {
  it("accepts only name and URL and derives an origin without the path or query", () => {
    const result = parseOnboardingForm(form({ name: " Acme ", url: minimal.url }));
    expect(result.success).toBe(true);
    if (!result.success) throw result.error;
    expect(result.data).toMatchObject({
      ...minimal,
      permitted_origins: ["https://app.example.com"],
      language: "en",
      description: "",
      audience: "",
      release_notes: [],
      support_complaints: [],
      known_journeys: [],
      product_events: [],
    });
    expect(result.data.repo_binding).toBeUndefined();
  });

  it.each([
    { name: "   ", url: minimal.url },
    { name: "Acme", url: "" },
    { name: "Acme", url: "not-a-url" },
    { name: "Acme", url: "ftp://example.com" },
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
      status: "ready",
      permittedOrigins: ["https://app.example.com"],
      embedMode: "hosted",
      repoBinding: null,
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
    const parsed = parseOnboardingForm(form(minimal));
    if (!parsed.success) throw parsed.error;
    const product = await createOwnerProduct(userId, parsed.data, undefined, async () => [
      "10.0.0.1",
    ]);
    expect(product).toMatchObject({ status: "needs_setup", setupError: "destination_not_allowed" });
  });
});

describe("discovery with minimal context", () => {
  it("allows exploratory research without pretending release notes or complaints exist", () => {
    const prompt = buildDiscoveryPrompt(
      {
        ...ProductConfigSchema.parse(minimal),
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
