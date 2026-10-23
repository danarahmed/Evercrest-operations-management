"use server";
import { createHash, timingSafeEqual } from "node:crypto";
import { getDb } from "@/db/client";
import "@/domain/register";
import { Conflict } from "@/server/errors";
import { provisionCompany } from "@/server/provision";
import { siteUrl, supabaseSecretKey, supabaseUrl } from "@/server/supabase";

export interface WelcomeState {
  error?: "code" | "fields" | "already" | "failed";
  detail?: string;
  done?: { email: string; invited: boolean };
}

const digest = (s: string) => createHash("sha256").update(s).digest();

/** First-run setup, allowed once, only with the SETUP_TOKEN code set in the hosting settings. */
export async function runFirstSetup(_prev: WelcomeState, form: FormData): Promise<WelcomeState> {
  const expected = process.env.SETUP_TOKEN ?? "";
  const given = String(form.get("code") ?? "");
  if (expected.length < 24 || !timingSafeEqual(digest(expected), digest(given))) return { error: "code" };
  const companyName = String(form.get("companyName") ?? "").trim();
  const adminName = String(form.get("adminName") ?? "").trim();
  const adminEmail = String(form.get("adminEmail") ?? "").trim();
  const locale = String(form.get("adminLocale") ?? "en");
  if (!companyName || !adminName || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail) || !["en", "ar", "ckb"].includes(locale)) return { error: "fields" };
  try {
    const r = await provisionCompany(getDb(), { companyName, adminName, adminEmail, locale: locale as "en" | "ar" | "ckb" }, { url: supabaseUrl(), secretKey: supabaseSecretKey(), siteUrl: siteUrl() });
    return { done: { email: r.adminEmail, invited: r.invited } };
  } catch (e) {
    if (e instanceof Conflict) return { error: "already" };
    console.error("first-run setup failed", e);
    return { error: "failed", detail: (e as Error).message };
  }
}
