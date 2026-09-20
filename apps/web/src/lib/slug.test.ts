import { describe, expect, it } from "vitest";
import { slugify } from "./slug";

describe("slugify", () => {
  it("lowercases and collapses non-alphanumeric runs into dashes", () => {
    expect(slugify("Excalidraw")).toBe("excalidraw");
    expect(slugify("Acme Booking App")).toBe("acme-booking-app");
    expect(slugify("  --Weird__ Name!! ")).toBe("weird-name");
  });

  it("falls back to 'product' when nothing usable remains", () => {
    expect(slugify("")).toBe("product");
    expect(slugify("!!!")).toBe("product");
  });
});
