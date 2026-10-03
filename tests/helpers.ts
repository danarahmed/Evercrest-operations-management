import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { loadActor } from "@/server/actor";
import { setupCompany } from "@/server/bootstrap";
import "@/domain/register";

/** Fresh in-process Postgres with all real migrations applied, plus a company and admin actor. */
export async function freshDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "src/db/migrations" });
  const typed = db as unknown as Db;
  const { companyId, adminUserId } = await setupCompany(typed, {
    companyName: "Evercrest Test",
    adminEmail: "admin@test.local",
    adminName: "Admin",
  });
  const admin = await loadActor(typed, adminUserId);
  return { db: typed, client, companyId, admin, close: () => client.close() };
}

/** Run raw SQL expecting a database guard to reject it; returns the underlying Postgres message. */
export async function dbRejects(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const cause = (e as { cause?: { message?: string } }).cause;
    return cause?.message ?? (e as Error).message;
  }
  throw new Error("expected the database to reject the statement");
}
