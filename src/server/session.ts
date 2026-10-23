import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import "@/domain/register";
import { loadActor } from "./actor";
import type { Actor } from "./authz";
import { linkAuthIdentity } from "./identity";
import { authMode, supabaseServer } from "./supabase";

/** Development sign-in only: a cookie holding the user id (AUTH_MODE=dev, never in production). */
export const SESSION_COOKIE = "ev_session";

/**
 * Resolve the signed-in user and their permissions.
 * - AUTH_MODE=supabase (default): Supabase Auth session → the linked ERP user.
 * - AUTH_MODE=dev: the development cookie (local work and automated UI tests).
 * Anyone without a session, without an ERP user, or deactivated goes to the sign-in page.
 * Cached per request (the shell and the page both ask).
 */
export const currentActor = cache(async function currentActor(locale: string): Promise<Actor> {
  const db = getDb();
  let userId: string | null = null;
  if (authMode() === "dev") {
    userId = (await cookies()).get(SESSION_COOKIE)?.value ?? null;
    if (!userId) redirect(`/${locale}/login`);
  } else {
    const sb = await supabaseServer();
    const { data } = await sb.auth.getUser();
    if (!data.user) redirect(`/${locale}/login`);
    userId = await linkAuthIdentity(db, data.user.id, data.user.email);
    if (!userId) redirect(`/${locale}/login?error=no_access`);
  }
  try {
    return await loadActor(db, userId);
  } catch {
    redirect(`/${locale}/login?error=no_access`);
  }
});
