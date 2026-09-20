import { describe, expect, it } from "vitest";
import type { ApiError } from "./api";
import { primaryTenant, type TenantActor } from "./tenant-access";

const session = (tenantIds: string[]): TenantActor => ({ tenantIds, via: "session", userId: "u" });

describe("primaryTenant", () => {
  it("uses the only tenant when there is one", () => {
    expect(primaryTenant({ tenantIds: ["t1"], via: "api_key", userId: null })).toBe("t1");
    expect(primaryTenant(session(["t1"]))).toBe("t1");
  });

  it("requires an explicit tenant when the user belongs to several", () => {
    expect(() => primaryTenant(session(["t2", "t1"]))).toThrowError(
      expect.objectContaining({ status: 400, code: "tenant_required" }) as ApiError,
    );
    expect(primaryTenant(session(["t2", "t1"]), "t1")).toBe("t1");
  });

  it("refuses a tenant the actor is not a member of", () => {
    expect(() => primaryTenant(session(["t1"]), "t9")).toThrowError(
      expect.objectContaining({ status: 403, code: "not_a_member" }) as ApiError,
    );
    expect(() => primaryTenant(session([]))).toThrowError(
      expect.objectContaining({ status: 403, code: "no_tenant" }) as ApiError,
    );
  });
});
