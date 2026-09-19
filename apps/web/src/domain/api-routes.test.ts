import { beforeEach, describe, expect, it } from "vitest";
import { GET as getProduct } from "@/app/api/products/[id]/route";
import { POST as postProducts } from "@/app/api/products/route";
import { POST as postStudies } from "@/app/api/studies/route";
import { db, schema } from "@/db/client";
import { hashApiKey } from "@/lib/tenant-access";
import { resetDb } from "@/test/db";

async function seedKeys() {
  await db.insert(schema.tenants).values([
    { id: "tenant_a", name: "a" },
    { id: "tenant_b", name: "b" },
  ]);
  await db.insert(schema.apiKeys).values([
    { id: "k_a", tenantId: "tenant_a", keyHash: hashApiKey("key-a"), label: "a" },
    { id: "k_b", tenantId: "tenant_b", keyHash: hashApiKey("key-b"), label: "b" },
  ]);
}

const req = (url: string, key: string | null, init: RequestInit = {}) =>
  new Request(`http://localhost${url}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...(init.headers ?? {}),
    },
  });

beforeEach(async () => {
  await resetDb();
  await seedKeys();
  process.env.ALLOW_LOCAL_TARGETS = "true";
});

describe("VC-01 API tenancy", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await postProducts(
      req("/api/products", null, {
        method: "POST",
        body: JSON.stringify({ name: "x", url: "https://example.com" }),
      }),
      {} as never,
    );
    expect(res.status).toBe(401);
  });

  it("hides a product from another tenant", async () => {
    const created = await postProducts(
      req("/api/products", "key-a", {
        method: "POST",
        body: JSON.stringify({ name: "x", url: "https://example.com" }),
      }),
      {} as never,
    );
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const other = await getProduct(req(`/api/products/${id}`, "key-b"), {
      params: Promise.resolve({ id }),
    } as never);
    expect(other.status).toBe(404);
    const own = await getProduct(req(`/api/products/${id}`, "key-a"), {
      params: Promise.resolve({ id }),
    } as never);
    expect(own.status).toBe(200);
  });

  it("requires an idempotency key to publish", async () => {
    const res = await postStudies(
      req("/api/studies", "key-a", { method: "POST", body: "{}" }),
      {} as never,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("idempotency_key_required");
  });
});
