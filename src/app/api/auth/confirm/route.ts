import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/server/supabase";

/**
 * Landing point of the links in Supabase e-mails (invitation, password reset).
 * Verifies the link, which signs the person in, then sends them on — only ever
 * to a path inside this app (never to another site).
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const next = url.searchParams.get("next") ?? "/";
  const safeNext = /^\/(en|ar|ckb)(\/[\w\-/]*)?$/.test(next) ? next : "/en";
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");
  const sb = await supabaseServer();
  const { error } = tokenHash && type ? await sb.auth.verifyOtp({ type, token_hash: tokenHash }) : code ? await sb.auth.exchangeCodeForSession(code) : { error: new Error("missing token") };
  const locale = safeNext.split("/")[1] ?? "en";
  return NextResponse.redirect(new URL(error ? `/${locale}/login?error=link` : safeNext, url.origin));
}
