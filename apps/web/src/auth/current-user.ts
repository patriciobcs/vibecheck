import "server-only";

import { headers } from "next/headers";
import { auth } from "./auth";

/** Session derived from cookies. Never trust a caller-provided tenant or user id. */
export async function currentSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireUser() {
  const session = await currentSession();
  if (!session) throw new UnauthorizedError();
  return session.user;
}

export class UnauthorizedError extends Error {
  status = 401 as const;
  constructor() {
    super("unauthorized");
  }
}
