import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/db/client";
import { newId } from "@/lib/ids";
import { resetDb } from "@/test/db";
import { createDiscoveryRun, createProduct, sourceRevision, toProductConfig } from "./products";

beforeEach(async () => {
  await resetDb();
  await db.insert(schema.tenants).values({ id: "tenant_t", name: "t" });
});

const publicResolver = async () => ["93.184.216.34"];
const privateResolver = async () => ["10.0.0.1"];

describe("createProduct", () => {
  it("stores the config with a publishable key and marks it ready when destinations are public", async () => {
    const p = await createProduct(
      "tenant_t",
      { name: "Acme", url: "https://acme.example", permitted_origins: ["https://acme.example"] },
      publicResolver,
    );
    expect(p.status).toBe("ready");
    expect(p.publishableKey).toMatch(/^pk_/);
    expect(p.embedMode).toBe("hosted");
    expect(p.slug).toBe("acme");
    expect(toProductConfig(p).name).toBe("Acme");
  });

  it("derives a tenant-unique slug from the name and suffixes collisions", async () => {
    const first = await createProduct(
      "tenant_t",
      { name: "Acme App", url: "https://acme.example" },
      publicResolver,
    );
    const second = await createProduct(
      "tenant_t",
      { name: "Acme App!", url: "https://acme-two.example" },
      publicResolver,
    );
    expect(first.slug).toBe("acme-app");
    expect(second.slug).toBe("acme-app-2");
  });

  it("does not reject a private destination but records needs_setup with the reason", async () => {
    const p = await createProduct(
      "tenant_t",
      { name: "Internal", url: "http://intranet.example" },
      privateResolver,
    );
    expect(p.status).toBe("needs_setup");
    expect(p.setupError).toBe("destination_not_allowed");
  });

  it("source revision is stable for identical configuration", async () => {
    const p = await createProduct(
      "tenant_t",
      { name: "Acme", url: "https://acme.example" },
      publicResolver,
    );
    expect(sourceRevision(toProductConfig(p))).toBe(sourceRevision(toProductConfig(p)));
  });
});

describe("createDiscoveryRun", () => {
  it("creates a queued run bound to the current source revision and enqueues one job", async () => {
    const p = await createProduct(
      "tenant_t",
      { name: "Acme", url: "https://acme.example" },
      publicResolver,
    );
    const run = await createDiscoveryRun("tenant_t", p.id, "fixture");
    expect(run?.status).toBe("queued");
    expect(run?.sourceRevision).toBe(sourceRevision(toProductConfig(p)));
    const jobs = await db.query.jobs.findMany();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      type: "discovery.run",
      payload: { runId: run?.id, tenantId: "tenant_t" },
    });
  });

  it("returns null for a product of another tenant", async () => {
    await db
      .insert(schema.tenants)
      .values({ id: newId("tenant"), name: "other" })
      .onConflictDoNothing();
    const p = await createProduct(
      "tenant_t",
      { name: "Acme", url: "https://acme.example" },
      publicResolver,
    );
    expect(await createDiscoveryRun("tenant_other", p.id, "fixture")).toBeNull();
  });
});
