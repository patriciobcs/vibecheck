import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { verifyArchiveCallback } from "./vonage";

const secret = "callback-secret";
const enc = new TextEncoder().encode(secret);

describe("verifyArchiveCallback", () => {
  it("accepts a callback whose bearer JWT is signed with the configured secret", async () => {
    const jwt = await new SignJWT({ api_key: "app" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(enc);
    const result = await verifyArchiveCallback({ authorization: `Bearer ${jwt}`, secret });
    expect(result.ok).toBe(true);
  });

  it("rejects a JWT signed with a different secret", async () => {
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode("other"));
    const result = await verifyArchiveCallback({ authorization: `Bearer ${jwt}`, secret });
    expect(result.ok).toBe(false);
  });

  it("rejects a missing header", async () => {
    expect((await verifyArchiveCallback({ authorization: null, secret })).ok).toBe(false);
  });

  it("refuses to run unverified when no secret is configured", async () => {
    const result = await verifyArchiveCallback({ authorization: "Bearer x", secret: null });
    expect(result).toEqual({ ok: false, reason: "no_secret_configured" });
  });
});
