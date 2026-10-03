import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import * as schema from "./schema";

export type Schema = typeof schema;
/** A database handle or an open transaction; both share this interface. */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

let pool: Pool | undefined;

export function getDb(): Db {
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL });
  return drizzle(pool, { schema }) as unknown as Db;
}
