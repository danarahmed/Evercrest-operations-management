import "server-only";
import { authMode, siteUrl, supabaseAdmin } from "./supabase";

/**
 * E-mail a sign-in invitation through Supabase Auth. The link lands on
 * /api/auth/confirm, which signs the person in and asks them to choose a password.
 * Someone who already has a Supabase account gets a password link instead.
 * Does nothing with the development sign-in.
 */
export async function sendInvitation(email: string, locale: string) {
  if (authMode() !== "supabase") return;
  const redirectTo = `${siteUrl()}/api/auth/confirm?next=/${locale}/set-password`;
  const admin = supabaseAdmin();
  const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
  if (!error) return;
  if (/already|registered|exists/i.test(error.message)) {
    const { error: e2 } = await admin.auth.resetPasswordForEmail(email, { redirectTo });
    if (!e2) return;
    throw e2;
  }
  throw error;
}
