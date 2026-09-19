import { randomBytes, randomUUID } from "node:crypto";

/** Opaque prefixed ids, e.g. `assignment_5f3c…`. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

/** URL-safe secret token (invitations, upload tokens). */
export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
