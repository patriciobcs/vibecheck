import { createHash } from "node:crypto";

/** API keys are stored hashed; this helper has no server-only imports so scripts can use it. */
export const hashApiKey = (key: string) => createHash("sha256").update(key).digest("hex");
