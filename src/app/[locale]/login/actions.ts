"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/server/session";
import { authMode, siteUrl, supabaseServer } from "@/server/supabase";

export interface AuthFormState {
  error?: "invalid" | "missing" | "weak" | "mismatch" | "failed";
  sent?: boolean;
}

export async function devSignIn(locale: string, userId: string) {
  if (authMode() !== "dev") throw new Error("Development sign-in is disabled");
  (await cookies()).set(SESSION_COOKIE, userId, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect(`/${locale}`);
}

/** E-mail and password sign-in. The same message for every failure, so it never reveals which e-mails exist. */
export async function signIn(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const locale = String(form.get("locale") ?? "en");
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "missing" };
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return { error: "invalid" };
  redirect(`/${locale}`);
}

/** "Forgot password": always answers "sent" so it never reveals which e-mails exist. */
export async function requestPasswordReset(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const locale = String(form.get("locale") ?? "en");
  const email = String(form.get("email") ?? "").trim();
  if (!email) return { error: "missing" };
  const sb = await supabaseServer();
  await sb.auth.resetPasswordForEmail(email, { redirectTo: `${siteUrl()}/api/auth/confirm?next=/${locale}/set-password` });
  return { sent: true };
}

/** Choose a password after an invitation or a reset link (the link signed the person in). */
export async function setPassword(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const locale = String(form.get("locale") ?? "en");
  const password = String(form.get("password") ?? "");
  if (password.length < 10) return { error: "weak" };
  if (password !== String(form.get("confirm") ?? "")) return { error: "mismatch" };
  const sb = await supabaseServer();
  const { error } = await sb.auth.updateUser({ password });
  if (error) return { error: "failed" };
  redirect(`/${locale}`);
}

export async function signOut(locale: string) {
  if (authMode() === "dev") (await cookies()).delete(SESSION_COOKIE);
  else await (await supabaseServer()).auth.signOut();
  redirect(`/${locale}/login`);
}
