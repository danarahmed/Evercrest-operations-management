import Link from "next/link";
import { getTranslations } from "next-intl/server";

/** Sub-navigation of the finance area. */
export async function FinanceNav({ locale, current }: { locale: string; current: "invoices" | "accounts" | "journal" | "exchange" | "partners" }) {
  const t = await getTranslations({ locale, namespace: "FinanceNav" });
  const items = [
    ["invoices", ""],
    ["accounts", "/accounts"],
    ["partners", "/partners"],
    ["journal", "/journal"],
    ["exchange", "/exchange"],
  ] as const;
  return (
    <nav className="subnav no-print">
      {items.map(([k, path]) => (
        <Link key={k} href={`/${locale}/finance${path}`} className={k === current ? "active" : ""}>{t(k)}</Link>
      ))}
    </nav>
  );
}
