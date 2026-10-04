import { and, eq, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { getDb } from "@/db/client";
import { approvalRequests, documents } from "@/db/schema";
import { Icon, type IconName } from "@/components/icons";
import { initials } from "@/components/ui";
import { routing } from "@/i18n/routing";
import { currentActor } from "@/server/session";
import { signOut } from "./login/actions";

const LANG_NAMES: Record<string, string> = { en: "EN", ar: "عربي", ckb: "کوردی" };

type NavItem = { key: string; href: string; icon: IconName; show: boolean; count?: number; exact?: boolean };

/**
 * The application frame: navigation on the side (grouped like the business),
 * language and user at the top. Links a user cannot use are not shown; the
 * server still enforces every permission.
 */
export async function Shell({ locale, userName, path, permissions, wide, children }: {
  locale: string;
  userName: string;
  path: string;
  permissions: ReadonlySet<string>;
  wide?: boolean;
  children: ReactNode;
}) {
  const t = await getTranslations({ locale, namespace: "Nav" });
  const app = await getTranslations({ locale, namespace: "App" });
  const nl = await getTranslations({ locale, namespace: "NavLinks" });
  const has = (p: string) => permissions.has(p);
  const actor = await currentActor(locale);
  const db = getDb();
  const count = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const [pendingApprovals, toVerify] = await Promise.all([
    has("approvals.decide") ? count(db.select({ n: sql<number>`count(*)::int` }).from(approvalRequests).where(and(eq(approvalRequests.companyId, actor.companyId), eq(approvalRequests.status, "pending")))) : 0,
    has("documents.verify") ? count(db.select({ n: sql<number>`count(*)::int` }).from(documents).where(and(eq(documents.companyId, actor.companyId), eq(documents.status, "received")))) : 0,
  ]);

  const groups: { label?: string; items: NavItem[] }[] = [
    {
      items: [
        { key: "dashboard", href: "", icon: "home", show: true, exact: true },
        { key: "jobs", href: "/jobs", icon: "briefcase", show: has("jobs.view") },
      ],
    },
    {
      label: nl("groupOperations"),
      items: [
        { key: "statements", href: "/statements", icon: "users", show: has("settlements.create") },
        { key: "documents", href: "/documents", icon: "file", show: has("documents.verify"), count: toVerify },
        { key: "approvals", href: "/approvals", icon: "checkCircle", show: has("approvals.decide"), count: pendingApprovals },
      ],
    },
    {
      label: nl("groupFinance"),
      items: [
        { key: "finance", href: "/finance", icon: "receipt", show: has("reports.financial.view") || has("invoices.create"), exact: true },
        { key: "cashBooks", href: "/finance/accounts", icon: "bank", show: has("reports.financial.view") },
        { key: "partnerAccounts", href: "/finance/partners", icon: "wallet", show: has("reports.financial.view") },
        { key: "journal", href: "/finance/journal", icon: "book", show: has("reports.financial.view") },
        { key: "exchange", href: "/finance/exchange", icon: "exchange", show: has("reports.financial.view") },
        { key: "reports", href: "/reports", icon: "chart", show: has("reports.financial.view") },
      ],
    },
    {
      label: nl("groupAdmin"),
      items: [
        { key: "setup", href: "/setup", icon: "settings", show: ["partners.manage", "accounts.manage", "settings.manage", "job_types.manage", "documents.configure", "rates.manage", "catalog.manage", "contracts.manage"].some(has) },
        { key: "admin", href: "/admin", icon: "shield", show: has("users.manage") || has("roles.manage") },
      ],
    },
  ];
  const isActive = (i: NavItem) => (i.exact ? path === i.href || (i.href === "/finance" && path.startsWith("/finance/invoices")) : path === i.href || path.startsWith(`${i.href}/`) || (i.key === "jobs" && path.startsWith("/jobs")));

  return (
    <div className="app">
      <input type="checkbox" id="nav-toggle" className="nav-toggle" aria-hidden="true" />
      <aside className="sidebar">
        <Link href={`/${locale}`} className="brand">
          <span className="brand-mark">E</span>
          <span>
            <span className="brand-name">{app("title")}</span>
            <br />
            <span className="brand-sub">{app("tagline")}</span>
          </span>
        </Link>
        {groups.map((g, gi) => {
          const items = g.items.filter((i) => i.show);
          if (!items.length) return null;
          return (
            <nav key={gi} className="nav-group">
              {g.label && <div className="nav-label">{g.label}</div>}
              {items.map((i) => (
                <Link key={i.key} href={`/${locale}${i.href}`} className={`nav-link${isActive(i) ? " active" : ""}`}>
                  <Icon name={i.icon} />
                  <span>{nl(i.key)}</span>
                  {!!i.count && <span className="nav-count">{i.count}</span>}
                </Link>
              ))}
            </nav>
          );
        })}
        <div className="sidebar-foot">{app("footer")}</div>
      </aside>
      <label htmlFor="nav-toggle" className="scrim" aria-hidden="true" />
      <div className="main-area">
        <header className="topbar">
          <label htmlFor="nav-toggle" className="btn ghost icon-btn menu-btn" aria-label="Menu"><Icon name="menu" /></label>
          <div className="spacer" />
          <div className="lang-switch" aria-label="Language">
            {routing.locales.map((l) => (
              <Link key={l} href={`/${l}${path}`} className={l === locale ? "active" : ""} lang={l}>{LANG_NAMES[l]}</Link>
            ))}
          </div>
          <div className="user-chip">
            <span className="avatar">{initials(userName)}</span>
            <span className="user-name">{userName}</span>
          </div>
          <form action={signOut.bind(null, locale)}>
            <button type="submit" className="ghost icon-btn" title={t("signOut")} aria-label={t("signOut")}><Icon name="logout" /></button>
          </form>
        </header>
        <main className={`content${wide ? " wide" : ""}`}>{children}</main>
      </div>
    </div>
  );
}
