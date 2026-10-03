import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { routing } from "@/i18n/routing";
import { signOut } from "./login/actions";

const LANG_NAMES: Record<string, string> = { en: "English", ar: "العربية", ckb: "کوردی" };

export async function Shell({ locale, userName, path, children }: { locale: string; userName: string; path: string; children: ReactNode }) {
  const t = await getTranslations({ locale, namespace: "Nav" });
  const app = await getTranslations({ locale, namespace: "App" });
  return (
    <>
      <header className="top">
        <Link href={`/${locale}`}><strong>{app("title")}</strong></Link>
        <nav>
          {routing.locales.filter((l) => l !== locale).map((l) => (
            <Link key={l} href={`/${l}${path}`}>{LANG_NAMES[l]}</Link>
          ))}
          <span>{t("signedInAs", { name: userName })}</span>
          <form action={signOut.bind(null, locale)}><button type="submit">{t("signOut")}</button></form>
        </nav>
      </header>
      <main>{children}</main>
    </>
  );
}
