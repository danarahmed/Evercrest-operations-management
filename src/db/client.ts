import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool, type PoolConfig } from "pg";
import * as schema from "./schema";

export type Schema = typeof schema;
/** A database handle or an open transaction; both share this interface. */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

let pool: Pool | undefined;

/**
 * Connection settings. On Supabase the connection is encrypted and the server's
 * certificate is checked against Supabase's CA certificate (DATABASE_CA_CERT,
 * the PEM text from Database settings → SSL). DATABASE_POOL_MAX keeps the number
 * of connections small on serverless hosting (Vercel), where the transaction
 * pooler (port 6543) is used.
 */
export function poolConfig(): PoolConfig {
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");
  const url = process.env.DATABASE_URL;
  return {
    // With a CA certificate, TLS settings come from here (the URL's sslmode would override them).
    connectionString: ca ? url?.replace(/([?&])sslmode=[^&]*&?/, "$1").replace(/[?&]$/, "") : url,
    ssl: ca ? { ca, rejectUnauthorized: true } : undefined,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  };
}

export function getDb(): Db {
  pool ??= new Pool(poolConfig());
  return drizzle(pool, { schema }) as unknown as Db;
}
