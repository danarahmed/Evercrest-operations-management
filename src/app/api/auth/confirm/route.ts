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
  const locale = safeNext.split("/")[1] ?? "en";
  // No token in the query: the session (if any) is in the address fragment, which the login page reads.
  if (!(tokenHash && type) && !code) return NextResponse.redirect(new URL(`/${locale}/login?view=link`, url.origin));
  const sb = await supabaseServer();
  const { error } = tokenHash && type ? await sb.auth.verifyOtp({ type, token_hash: tokenHash }) : await sb.auth.exchangeCodeForSession(code!);
  return NextResponse.redirect(new URL(error ? `/${locale}/login?error=link` : safeNext, url.origin));
}
