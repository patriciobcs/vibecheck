import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** Creates the isolated test database if needed and applies migrations before the suite runs. */
export default async function setup() {
  config({ path: ".env.local", quiet: true });
  config({ path: ".env.test", quiet: true, override: true });
  const url = new URL(process.env.DATABASE_URL ?? "");
  const dbName = url.pathname.slice(1);
  if (!dbName.endsWith("_test"))
    throw new Error(`refusing to run integration tests against non-test database "${dbName}"`);

  const admin = postgres({ ...connection(url), database: "postgres", max: 1, onnotice: () => {} });
  const exists = await admin`select 1 from pg_database where datname = ${dbName}`;
  if (exists.length === 0) await admin.unsafe(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  await sql.end();
}

function connection(url: URL) {
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}
