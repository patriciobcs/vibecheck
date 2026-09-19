import { describe, expect, it } from "vitest";
import { scrubUrl } from "./url-scrub";

describe("scrubUrl", () => {
  it("keeps origin and path, drops query and hash", () => {
    expect(scrubUrl("https://app.example.com/book/123?token=abc#step2")).toBe(
      "https://app.example.com/book/123",
    );
  });

  it("returns 'invalid' for unparsable input instead of throwing", () => {
    expect(scrubUrl("not a url")).toBe("invalid");
  });

  it("masks path segments that look like long tokens", () => {
    expect(scrubUrl("https://a.com/reset/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG")).toBe(
      "https://a.com/reset/[token]",
    );
  });
});
