import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { routing } from "@/i18n/routing";

const LANG_NAMES: Record<string, string> = { en: "English", ar: "العربية", ckb: "کوردی" };

/** The sign-in card, shared by the sign-in and set-password pages. */
export async function AuthCard({ locale, title, children, path }: { locale: string; title: string; children: ReactNode; path: string }) {
  const app = await getTranslations({ locale, namespace: "App" });
  return (
    <div className="auth">
      <div className="auth-card">
        <div className="brand">
          <span className="brand-mark">
            <svg viewBox="0 0 24 24" className="size-5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3c3 4 6 7 6 10.5A6 6 0 0 1 6 13.5C6 10 9 7 12 3z" /><path d="M8.5 15.5c1 1.2 2.2 1.8 3.5 1.8" /></svg>
          </span>
          <span className="grid">
            <span className="brand-name">{app("brand")}</span>
            <span className="brand-sub">{app("tagline")}</span>
          </span>
        </div>
        <h1 className="!mb-4 !text-[21px]">{title}</h1>
        {children}
        <div className="mt-6 flex justify-center gap-1">
          {routing.locales.map((l) => <Link key={l} href={`/${l}${path}`} className={`chip ${l === locale ? "on" : ""}`} lang={l}>{LANG_NAMES[l]}</Link>)}
        </div>
      </div>
    </div>
  );
}

