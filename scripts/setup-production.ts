/**
 * One-time setup of the live system on Supabase, from a computer with the repository.
 * (The same can be done in the browser on the first-run setup page, /en/welcome; see docs/supabase.md.)
 *
 *   DATABASE_URL=<session pooler, port 5432> NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SECRET_KEY=... SITE_URL=... \
 *   COMPANY_NAME="Evercrest" ADMIN_EMAIL=... ADMIN_NAME="..." [ADMIN_LOCALE=ckb] npx tsx scripts/setup-production.ts
 */
import { getDb } from "@/db/client";
import "@/domain/register";
import { provisionCompany } from "@/server/provision";

const need = (n: string) => {
  const v = process.env[n];
  if (!v) throw new Error(`Set ${n}`);
  return v;
};
const r = await provisionCompany(
  getDb(),
  { companyName: need("COMPANY_NAME"), adminEmail: need("ADMIN_EMAIL"), adminName: need("ADMIN_NAME"), locale: (process.env.ADMIN_LOCALE ?? "en") as "en" | "ar" | "ckb" },
  { url: need("NEXT_PUBLIC_SUPABASE_URL"), secretKey: process.env.SUPABASE_SECRET_KEY ?? need("SUPABASE_SERVICE_ROLE_KEY"), siteUrl: need("SITE_URL") },
);
console.log("✓ storage bucket, company, administrator and starter configuration");
console.log(r.invited ? `✓ invitation sent to ${r.adminEmail}` : `! invitation not sent (${r.inviteError}); use "Forgot your password?" with ${r.adminEmail}`);
process.exit(0);
