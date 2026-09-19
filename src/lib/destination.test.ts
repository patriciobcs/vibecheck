import { describe, expect, it, vi } from "vitest";
import { assertAllowedDestination, checkedFetch } from "./destination";

const resolver = async (host: string) => host === "localhost" ? ["127.0.0.1"] : host === "ipv6.test" ? ["::1"] : host === "private.test" ? ["10.0.0.1"] : ["93.184.216.34"];

describe("destination rules", () => {
  it("blocks private and metadata destinations", async () => {
    await expect(assertAllowedDestination("http://private.test", resolver)).rejects.toThrow();
    await expect(assertAllowedDestination("http://169.254.169.254", async () => ["169.254.169.254"])).rejects.toThrow();
  });
  it("allows localhost only when explicitly enabled", async () => {
    delete process.env.ALLOW_LOCAL_TARGETS;
    await expect(assertAllowedDestination("http://localhost", resolver)).rejects.toThrow();
    process.env.ALLOW_LOCAL_TARGETS = "true";
    await expect(assertAllowedDestination("http://localhost", resolver)).resolves.toBeInstanceOf(URL);
    delete process.env.ALLOW_LOCAL_TARGETS;
    await expect(assertAllowedDestination("http://ipv6.test", resolver)).rejects.toThrow();
  });
  it("rechecks redirects", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "http://private.test" } }));
    await expect(checkedFetch("http://example.test", undefined, resolver)).rejects.toThrow();
    fetchMock.mockRestore();
  });
});
