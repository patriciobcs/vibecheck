"use client";

/** Fetch helper for the participant dialog: bearer assignment token or, on VibeCheck pages, the cookie. */
export function makeApi(token: string | null) {
  const headers = (extra: Record<string, string> = {}) => ({
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  });
  return {
    async get<T>(path: string): Promise<T> {
      const res = await fetch(path, { headers: headers(), credentials: "include" });
      if (!res.ok) throw new Error(await errorText(res));
      return (await res.json()) as T;
    },
    async post<T = Record<string, unknown>>(path: string, body: unknown): Promise<T> {
      const res = await fetch(path, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
        credentials: "include",
      });
      if (!res.ok) throw new Error(await errorText(res));
      return (await res.json().catch(() => ({}))) as T;
    },
  };
}

async function errorText(res: Response) {
  const json = (await res.json().catch(() => ({}))) as { detail?: unknown; error?: unknown };
  return typeof json.detail === "string"
    ? json.detail
    : typeof json.error === "string"
      ? json.error
      : `HTTP ${res.status}`;
}

export type Api = ReturnType<typeof makeApi>;
