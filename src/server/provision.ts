import { createClient } from "@supabase/supabase-js";
import type { Db } from "@/db/client";
import { loadActor } from "./actor";
import { setupCompany } from "./bootstrap";
import { applyStarterConfiguration } from "./starter";

export interface ProvisionInput {
  companyName: string;
  adminEmail: string;
  adminName: string;
  locale: "en" | "ar" | "ckb";
}
export interface SupabaseAccess {
  url: string;
  secretKey: string;
  siteUrl: string;
}

/**
 * First-run setup of the live system, used by the setup page and by
 * scripts/setup-production.ts: the private "documents" storage bucket, the
 * company with its first administrator (all permissions), the starter
 * configuration, and the administrator's invitation e-mail.
 * Refuses when a company already exists (checked under a lock).
 */
export async function provisionCompany(db: Db, input: ProvisionInput, supabase: SupabaseAccess) {
  const client = createClient(supabase.url, supabase.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const bucketOptions = { public: false, fileSizeLimit: "15MB", allowedMimeTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"] };
  const { data: bucket } = await client.storage.getBucket("documents");
  const { error: bucketError } = bucket ? await client.storage.updateBucket("documents", bucketOptions) : await client.storage.createBucket("documents", bucketOptions);
  if (bucketError) throw new Error(`Storage bucket: ${bucketError.message}`);

  const adminEmail = input.adminEmail.trim().toLowerCase();
  const { adminUserId } = await setupCompany(db, { ...input, adminEmail, onlyIfEmpty: true });
  await applyStarterConfiguration(db, await loadActor(db, adminUserId));

  const { error: inviteError } = await client.auth.admin.inviteUserByEmail(adminEmail, {
    redirectTo: `${supabase.siteUrl.replace(/\/$/, "")}/api/auth/confirm?next=/${input.locale}/set-password`,
  });
  return { adminUserId, adminEmail, invited: !inviteError, inviteError: inviteError?.message };
}
