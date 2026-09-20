import { createHash } from "node:crypto";
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

  it("ties the token to the body through payload_hash, as Vonage sends it", async () => {
    const sign = (claims: Record<string, unknown>) =>
      new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setIssuedAt().sign(enc);
    const body = JSON.stringify({ id: "arch_1", status: "available" });
    const hash = createHash("sha256").update(body).digest("hex");
    const args = { secret, rawBody: body };
    const good = await sign({ iss: "Vonage", jti: "j1", payload_hash: hash });
    const tampered = await sign({ iss: "Vonage", jti: "j2", payload_hash: "0".repeat(64) });
    const noHash = await sign({ iss: "Vonage" });
    expect((await verifyArchiveCallback({ ...args, authorization: `Bearer ${good}` })).ok).toBe(
      true,
    );
    expect((await verifyArchiveCallback({ ...args, authorization: `Bearer ${noHash}` })).ok).toBe(
      true,
    );
    const bad = await verifyArchiveCallback({ ...args, authorization: `Bearer ${tampered}` });
    expect(bad.ok === false && bad.reason).toMatch(/^payload_hash_mismatch/);
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
