import { createHash } from "node:crypto";
import { prisma } from "./prisma";

export async function tenantFromRequest(request: Request) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const key = header.slice(7);
  if (!key) return null;
  const keyHash = createHash("sha256").update(key).digest("hex");
  const found = await prisma.apiKey.findUnique({ where: { keyHash } });
  return found?.tenantId ?? null;
}

export async function tenantFromEnvironment() {
  const key = process.env.DEV_API_KEY;
  if (!key) return null;
  const keyHash = createHash("sha256").update(key).digest("hex");
  const found = await prisma.apiKey.findUnique({ where: { keyHash } });
  return found?.tenantId ?? null;
}

export function apiError(message: string, code = "bad_request", status = 400) {
  return Response.json({ error: { code, message } }, { status });
}
