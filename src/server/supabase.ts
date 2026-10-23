import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Supabase in this ERP:
 * - Auth: who is signed in (email + password; users are invited from Users & roles).
 * - Storage: scanned document files, in a private bucket.
 * - Postgres: the database itself, reached directly through DATABASE_URL (Drizzle).
 * The browser never talks to the database; all data goes through server commands.
 */
export type AuthMode = "dev" | "supabase";

export function authMode(): AuthMode {
  const mode = process.env.AUTH_MODE ?? "supabase";
  if (mode === "dev") {
    // The development sign-in (pick a user, no password) must never run on the live site.
    if (process.env.VERCEL_ENV === "production") throw new Error("AUTH_MODE=dev is not allowed in production");
    return "dev";
  }
  return "supabase";
}

function env(name: string, ...fallbacks: string[]) {
  for (const n of [name, ...fallbacks]) if (process.env[n]) return process.env[n] as string;
  throw new Error(`Missing environment variable ${name}`);
}

export const supabaseUrl = () => env("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL");
/** The public (publishable / anon) key: identifies the project, grants nothing on its own. */
export const supabasePublicKey = () => env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY");
/** The secret (service role) key: server only, never sent to the browser. */
const supabaseSecretKey = () => env("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");

/** Where invitation and password e-mails send people back to. */
export function siteUrl() {
  const url = process.env.SITE_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");
  return url.replace(/\/$/, "");
}

export const DOCUMENTS_BUCKET = "documents";

/** Auth client bound to the current request's cookies (server components, actions, route handlers). */
export async function supabaseServer(): Promise<SupabaseClient> {
  const store = await cookies();
  return createServerClient(supabaseUrl(), supabasePublicKey(), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Server components cannot set cookies; the proxy refreshes the session instead.
        }
      },
    },
  });
}

let admin: SupabaseClient | undefined;
/** Privileged client for invitations and storage. Only used by server code after the ERP's own permission checks. */
export function supabaseAdmin(): SupabaseClient {
  admin ??= createClient(supabaseUrl(), supabaseSecretKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}
