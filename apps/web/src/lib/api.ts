import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { currentSession } from "@/auth/current-user";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(status: number, code: string, detail?: unknown) {
  return NextResponse.json(
    { error: code, ...(detail !== undefined ? { detail } : {}) },
    { status },
  );
}

/** Wraps a route handler: parses errors into stable JSON shapes and never leaks stack traces. */
export function route<TCtx>(handler: (req: Request, ctx: TCtx) => Promise<Response>) {
  return async (req: Request, ctx: TCtx): Promise<Response> => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof ApiError)
        return fail(err.status, err.code, err.message !== err.code ? err.message : undefined);
      console.error(err);
      return fail(500, "internal_error");
    }
  };
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "invalid_json");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    throw new ApiError(
      400,
      "invalid_body",
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  return parsed.data;
}

export async function requireSessionUser() {
  const session = await currentSession();
  if (!session) throw new ApiError(401, "unauthorized");
  return session.user;
}

/** Maps domain failure reasons to HTTP statuses. */
export function statusFor(reason: string): number {
  switch (reason) {
    case "not_found":
    case "unknown_key":
      return 404;
    case "unauthorized":
      return 401;
    case "origin_not_permitted":
      return 403;
    case "invalid_transition":
    case "study_full":
    case "invitation_exhausted":
    case "study_not_recruiting":
    case "paused":
    case "expired":
    case "not_recording":
    case "no_active_archive":
      return 409;
    case "media_unavailable":
      return 503;
    default:
      return 400;
  }
}
