"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/server/session";

export async function devSignIn(locale: string, userId: string) {
  if (process.env.AUTH_MODE !== "dev") throw new Error("Development sign-in is disabled");
  (await cookies()).set(SESSION_COOKIE, userId, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect(`/${locale}`);
}

export async function signOut(locale: string) {
  (await cookies()).delete(SESSION_COOKIE);
  redirect(`/${locale}/login`);
}
