import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  env = await freshDb();
});
afterAll(async () => env.close());

describe("database lock-down for Supabase", () => {
  it("every table has row level security, so Supabase's public Data API sees nothing", async () => {
    // A new table needs: ALTER TABLE ... ENABLE ROW LEVEL SECURITY in its migration.
    const open = await env.db.execute(sql`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1`);
    expect((open as unknown as { rows: { relname: string }[] }).rows.map((r) => r.relname)).toEqual([]);
  });

  it("the server's own connection still reads and writes normally", async () => {
    const r = await env.db.execute(sql`select count(*)::int as n from users`);
    expect((r as unknown as { rows: { n: number }[] }).rows[0].n).toBe(1);
  });
});
