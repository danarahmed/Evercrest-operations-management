import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import "@/domain/register";
import { loadActor } from "./actor";
import type { Actor } from "./authz";

export const SESSION_COOKIE = "ev_session";

/**
 * Resolve the signed-in user. Until real authentication (Supabase Auth) is
 * connected, only AUTH_MODE=dev is supported: a cookie holds the user id.
 * Dev mode must never be enabled in production.
 */
export async function currentActor(locale: string): Promise<Actor> {
  if (process.env.AUTH_MODE !== "dev") throw new Error("Authentication is not configured (set up Supabase Auth)");
  const userId = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!userId) redirect(`/${locale}/login`);
  try {
    return await loadActor(getDb(), userId);
  } catch {
    redirect(`/${locale}/login`);
  }
}
