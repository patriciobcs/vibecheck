import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./return-path";

describe("sign-in return paths", () => {
  it("preserves internal onboarding and participant destinations", () => {
    expect(safeReturnPath("/products/new")).toBe("/products/new");
    expect(safeReturnPath("/t/invite?study=one")).toBe("/t/invite?study=one");
    expect(safeReturnPath(null, "/marketplace")).toBe("/marketplace");
  });

  it.each([
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "/\n/evil.test",
    "/sign-in?next=/sign-in",
    undefined,
  ])("rejects external URLs and sign-in loops: %s", (input) =>
    expect(safeReturnPath(input)).toBe("/products"),
  );
});
