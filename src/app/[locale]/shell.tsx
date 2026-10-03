import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { routing } from "@/i18n/routing";
import { signOut } from "./login/actions";

const LANG_NAMES: Record<string, string> = { en: "English", ar: "العربية", ckb: "کوردی" };

export async function Shell({ locale, userName, path, permissions, wide, children }: {
  locale: string;
  userName: string;
  path: string;
  /** Links the user cannot use are not shown (the server still enforces). */
  permissions: ReadonlySet<string>;
  /** Use the full width for pages with wide tables. */
  wide?: boolean;
  children: ReactNode;
}) {
  const t = await getTranslations({ locale, namespace: "Nav" });
  const app = await getTranslations({ locale, namespace: "App" });
  const nl = await getTranslations({ locale, namespace: "NavLinks" });
  return (
    <>
      <header className="top">
        <Link href={`/${locale}`}><strong>{app("title")}</strong></Link>
        <nav>
          {(permissions.has("reports.financial.view") || permissions.has("invoices.create")) && <Link href={`/${locale}/finance`}>{nl("finance")}</Link>}
          {permissions.has("settlements.create") && <Link href={`/${locale}/statements`}>{nl("statements")}</Link>}
          {permissions.has("reports.financial.view") && <Link href={`/${locale}/reports`}>{nl("reports")}</Link>}
          {permissions.has("approvals.decide") && <Link href={`/${locale}/approvals`}>{nl("approvals")}</Link>}
          {permissions.has("documents.verify") && <Link href={`/${locale}/documents`}>{nl("documents")}</Link>}
          {["partners.manage", "accounts.manage", "settings.manage", "job_types.manage", "documents.configure", "rates.manage", "catalog.manage"].some((p) => permissions.has(p)) && (
            <Link href={`/${locale}/setup`}>{nl("setup")}</Link>
          )}
          {(permissions.has("users.manage") || permissions.has("roles.manage")) && <Link href={`/${locale}/admin`}>{nl("admin")}</Link>}
          <span aria-hidden>|</span>
          {routing.locales.filter((l) => l !== locale).map((l) => (
            <Link key={l} href={`/${l}${path}`}>{LANG_NAMES[l]}</Link>
          ))}
          <span>{t("signedInAs", { name: userName })}</span>
          <form action={signOut.bind(null, locale)}><button type="submit">{t("signOut")}</button></form>
        </nav>
      </header>
      <main className={wide ? "wide" : undefined}>{children}</main>
    </>
  );
}
