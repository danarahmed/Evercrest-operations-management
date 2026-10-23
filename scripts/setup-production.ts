/**
 * One-time setup of the live system on Supabase. Safe to re-run: it stops if
 * the company already exists, and the storage bucket step is idempotent.
 *
 *   DATABASE_URL=...            Supabase Postgres connection string (session pooler, port 5432)
 *   NEXT_PUBLIC_SUPABASE_URL=...  SUPABASE_SECRET_KEY=...
 *   SITE_URL=https://erp.example.com
 *   COMPANY_NAME="Evercrest" ADMIN_EMAIL=... ADMIN_NAME="..." [ADMIN_LOCALE=ckb]
 *   npm run db:migrate && npx tsx scripts/setup-production.ts
 *
 * It creates: the company and the first administrator (all permissions), the
 * starter configuration (accounts, posting accounts, job types, manifest rule,
 * cash boxes, suggested roles), the private "documents" storage bucket, and it
 * e-mails the administrator an invitation to choose a password.
 */
import { createClient } from "@supabase/supabase-js";
import { getDb } from "@/db/client";
import { companies } from "@/db/schema";
import "@/domain/register";
import { loadActor } from "@/server/actor";
import { setupCompany } from "@/server/bootstrap";
import { applyStarterConfiguration } from "@/server/starter";

const need = (n: string) => {
  const v = process.env[n];
  if (!v) throw new Error(`Set ${n}`);
  return v;
};
const supabaseUrl = need("NEXT_PUBLIC_SUPABASE_URL");
const secret = process.env.SUPABASE_SECRET_KEY ?? need("SUPABASE_SERVICE_ROLE_KEY");
const siteUrl = need("SITE_URL").replace(/\/$/, "");
const locale = (process.env.ADMIN_LOCALE ?? "en") as "en" | "ar" | "ckb";
const adminEmail = need("ADMIN_EMAIL").trim().toLowerCase();
const supabase = createClient(supabaseUrl, secret, { auth: { persistSession: false, autoRefreshToken: false } });

// 1. Storage bucket for scanned documents: private, 15 MB, PDF and photos only.
const bucketOptions = { public: false, fileSizeLimit: "15MB", allowedMimeTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"] };
const { data: bucket } = await supabase.storage.getBucket("documents");
const { error: bucketError } = bucket ? await supabase.storage.updateBucket("documents", bucketOptions) : await supabase.storage.createBucket("documents", bucketOptions);
if (bucketError) throw bucketError;
console.log("✓ storage bucket 'documents' (private)");

// 2. Company, administrator and starter configuration (only once).
const db = getDb();
const existing = await db.select().from(companies).limit(1);
if (existing.length) {
  console.log(`✓ company already set up (${existing[0].name}); nothing else to do`);
  process.exit(0);
}
const { adminUserId } = await setupCompany(db, { companyName: need("COMPANY_NAME"), adminEmail, adminName: need("ADMIN_NAME"), locale });
await applyStarterConfiguration(db, await loadActor(db, adminUserId));
console.log("✓ company, administrator and starter configuration");

// 3. Invitation e-mail: the administrator chooses a password and signs in.
const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(adminEmail, { redirectTo: `${siteUrl}/api/auth/confirm?next=/${locale}/set-password` });
if (inviteError) console.warn(`! invitation not sent (${inviteError.message}); use "Forgot your password?" on the sign-in page with ${adminEmail}`);
else console.log(`✓ invitation sent to ${adminEmail}`);
process.exit(0);
