import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

type SqlClient = ReturnType<typeof postgres>;
const globalCache = globalThis as unknown as { __vibecheckSql?: SqlClient };

function createSql(): SqlClient {
  return postgres(env().DATABASE_URL, { max: 10, prepare: false, onnotice: () => {} });
}

/** One connection pool per process; cached across Next.js hot reloads in development. */
const sql = globalCache.__vibecheckSql ?? createSql();
if (process.env.NODE_ENV !== "production") globalCache.__vibecheckSql = sql;

export const db = drizzle(sql, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema, sql };
