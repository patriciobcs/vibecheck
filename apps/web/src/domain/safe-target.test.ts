import { describe, expect, it } from "vitest";
import { safeTargetRef } from "./safe-target";

describe("safeTargetRef", () => {
  it("prefers data-testid", () => {
    expect(
      safeTargetRef({ tag: "button", testId: "book-now", id: "b1", role: null, text: "Book" }),
    ).toBe("button[data-testid=book-now]");
  });

  it("falls back to id then role", () => {
    expect(
      safeTargetRef({ tag: "a", testId: null, id: "nav-home", role: null, text: "Home" }),
    ).toBe("a#nav-home");
    expect(safeTargetRef({ tag: "div", testId: null, id: null, role: "dialog", text: "x" })).toBe(
      "div[role=dialog]",
    );
  });

  it("never includes text content of inputs", () => {
    expect(
      safeTargetRef({ tag: "input", testId: null, id: null, role: null, text: "secret" }),
    ).toBe("input");
  });

  it("truncates a short label for buttons and links only", () => {
    expect(
      safeTargetRef({
        tag: "button",
        testId: null,
        id: null,
        role: null,
        text: "Reschedule appointment now please",
      }),
    ).toBe('button:"Reschedule appoint…"');
  });
});
