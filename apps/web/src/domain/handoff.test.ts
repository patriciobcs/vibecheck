import { describe, expect, it } from "vitest";
import { participantDestination } from "./handoff";

describe("participantDestination", () => {
  it("sends SDK-instrumented products to the product URL with a fragment handoff", () => {
    expect(
      participantDestination({
        product: { url: "https://draw.example.test/", embedMode: "sdk" },
        assignmentId: "assignment_1",
        token: "tok.en",
      }),
    ).toBe("https://draw.example.test/#vc=tok.en");
  });

  it("keeps existing fragments out and preserves the path", () => {
    expect(
      participantDestination({
        product: { url: "https://a.test/app#old", embedMode: "sdk" },
        assignmentId: "x",
        token: "t",
      }),
    ).toBe("https://a.test/app#vc=t");
  });

  it("uses the hosted recorder for products without the SDK", () => {
    expect(
      participantDestination({
        product: { url: "https://a.test", embedMode: "hosted" },
        assignmentId: "assignment_1",
        token: "t",
      }),
    ).toBe("/a/assignment_1#vc=t");
  });
});
