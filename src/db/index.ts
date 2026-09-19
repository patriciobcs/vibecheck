import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { db?: ReturnType<typeof drizzle<typeof schema>> };

const client = postgres(process.env.DATABASE_URL ?? "", { max: 10 });
export const db = globalForDb.db ?? drizzle(client, { schema });
if (process.env.NODE_ENV !== "production") globalForDb.db = db;

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
