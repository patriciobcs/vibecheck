import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "@/test/db";
import { seedStudy } from "@/test/fixtures";
import { ownerProduct } from "./owner-products";

beforeEach(resetDb);

describe("ownerProduct", () => {
  it("resolves a product by id and by its tenant-unique slug", async () => {
    const { tenantId, productId } = await seedStudy();
    expect((await ownerProduct([tenantId], productId))?.id).toBe(productId);
    expect((await ownerProduct([tenantId], "test-product"))?.id).toBe(productId);
  });

  it("does not resolve another tenant's product or an empty scope", async () => {
    const { tenantId, productId } = await seedStudy();
    expect(await ownerProduct([tenantId], "missing-slug")).toBeUndefined();
    expect(await ownerProduct([`tenant_${tenantId}_other`], "test-product")).toBeUndefined();
    expect(await ownerProduct([], productId)).toBeNull();
  });
});
