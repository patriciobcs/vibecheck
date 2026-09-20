import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import { lazy } from "@/lib/lazy";
import * as schema from "./schema";

type SqlClient = ReturnType<typeof postgres>;
const globalCache = globalThis as unknown as { __vibecheckSql?: SqlClient };

/** One connection pool per process; cached across Next.js hot reloads in development. */
function createSql(): SqlClient {
  const cached = globalCache.__vibecheckSql;
  if (cached) return cached;
  const client = postgres(env().DATABASE_URL, { max: 10, prepare: false, onnotice: () => {} });
  if (process.env.NODE_ENV !== "production") globalCache.__vibecheckSql = client;
  return client;
}

/** Created on first use, so importing this module needs no environment (e.g. during `next build`). */
export const sql: SqlClient = lazy(createSql);
export const db = lazy(() => drizzle(createSql(), { schema }));
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };
