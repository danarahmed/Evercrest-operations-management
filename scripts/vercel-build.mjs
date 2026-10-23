// Build on Vercel. Production deployments first bring the database up to date
// (migrations are additive and recorded, so re-running them is safe); preview
// deployments never touch the live database.
// MIGRATION_DATABASE_URL (session pooler, port 5432) is used when set; otherwise DATABASE_URL.
import { execSync } from "node:child_process";

if (process.env.VERCEL_ENV === "production") {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL (and preferably MIGRATION_DATABASE_URL) before deploying to production");
  execSync("npm run db:migrate", { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
}
execSync("next build", { stdio: "inherit" });
