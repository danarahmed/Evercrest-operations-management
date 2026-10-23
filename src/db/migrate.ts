import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { poolConfig } from "./client";

const pool = new Pool({ ...poolConfig(), max: 1 });
await migrate(drizzle(pool), { migrationsFolder: "src/db/migrations" });
await pool.end();
console.log("migrations applied");
