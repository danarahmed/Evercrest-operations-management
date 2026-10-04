import { and, eq, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { getDb } from "@/db/client";
import { approvalRequests, documents, roles, userRoles } from "@/db/schema";
import { Icon, type IconName } from "@/components/icons";
import { NewMenu, type NotificationItem, Notifications } from "@/components/Notifications";
import { SearchBox } from "@/components/SearchBox";
import { initials } from "@/components/ui";
import { routing } from "@/i18n/routing";
import { currentActor } from "@/server/session";
import { signOut } from "./login/actions";

const LANG_NAMES: Record<string, string> = { en: "English", ar: "العربية", ckb: "کوردی" };

type NavItem = { key: string; href: string; icon: IconName; show: boolean; count?: number; exact?: boolean };

/**
 * The application frame: navigation on the side (grouped like the business),
 * language and user at the top. Links a user cannot use are not shown; the
 * server still enforces every permission.
 */
export async function Shell({ locale, userName, path, permissions, wide, crumb, children }: {
  locale: string;
  userName: string;
  path: string;
  permissions: ReadonlySet<string>;
  wide?: boolean;
  /** Last breadcrumb for a record page (job number, invoice number, partner name). */
  crumb?: string;
  children: ReactNode;
}) {
  const t = await getTranslations({ locale, namespace: "Nav" });
  const app = await getTranslations({ locale, namespace: "App" });
  const nl = await getTranslations({ locale, namespace: "NavLinks" });
  const has = (p: string) => permissions.has(p);
  const actor = await currentActor(locale);
  const db = getDb();
  const count = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const [pendingApprovals, toVerify, myRoles] = await Promise.all([
    has("approvals.decide") ? count(db.select({ n: sql<number>`count(*)::int` }).from(approvalRequests).where(and(eq(approvalRequests.companyId, actor.companyId), eq(approvalRequests.status, "pending")))) : 0,
    has("documents.verify") ? count(db.select({ n: sql<number>`count(*)::int` }).from(documents).where(and(eq(documents.companyId, actor.companyId), eq(documents.status, "received")))) : 0,
    db.select({ name: roles.name }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.userId, actor.userId)),
  ]);
  const roleLabel = [...new Set(myRoles.map((r) => r.name))].join(", ");

  const groups: { label?: string; items: NavItem[] }[] = [
    {
      items: [
        { key: "dashboard", href: "", icon: "home", show: true, exact: true },
        { key: "jobs", href: "/jobs", icon: "briefcase", show: has("jobs.view") },
        { key: "documents", href: "/documents", icon: "file", show: has("jobs.view"), count: toVerify },
        { key: "approvals", href: "/approvals", icon: "checkCircle", show: has("approvals.decide"), count: pendingApprovals },
      ],
    },
    {
      label: nl("groupOperations"),
      items: [
        { key: "statements", href: "/statements", icon: "users", show: has("settlements.create") },
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
  const isActive = (i: NavItem) => (i.exact ? path === i.href || (i.href === "/finance" && path.startsWith("/finance/invoices")) : path === i.href || path.startsWith(`${i.href}/`));

  // Breadcrumbs: section › page › record
  const current = groups.flatMap((g) => g.items.map((i) => ({ g, i }))).find(({ i }) => i.href && isActive(i));
  const subPage: Record<string, string> = { "/jobs/new": t("newJob"), "/admin/audit": t("auditLog") };
  const crumbs: { label: string; href?: string }[] = [];
  if (current) {
    crumbs.push({ label: nl(current.i.key), href: `/${locale}${current.i.href}` });
  }
  if (subPage[path]) crumbs.push({ label: subPage[path] });
  if (crumb) crumbs.push({ label: crumb });

  const notifications: NotificationItem[] = [
    ...(pendingApprovals ? [{ href: `/${locale}/approvals`, icon: "checkCircle" as const, title: t("toApprove", { count: pendingApprovals }), tone: "warning" as const }] : []),
    ...(toVerify ? [{ href: `/${locale}/documents`, icon: "file" as const, title: t("toVerify", { count: toVerify }), tone: "info" as const }] : []),
  ];

  const newItems = [
    ...(has("jobs.create") ? [{ href: `/${locale}/jobs/new`, icon: "briefcase" as const, label: t("newJob") }] : []),
    ...(has("invoices.create") ? [{ href: `/${locale}/finance`, icon: "receipt" as const, label: t("newInvoice") }] : []),
    ...(has("settlements.create") ? [{ href: `/${locale}/statements`, icon: "users" as const, label: t("newStatement") }] : []),
    ...(has("jobs.view") ? [{ href: `/${locale}/documents`, icon: "file" as const, label: t("newDocument") }] : []),
    ...(has("journal.post") ? [{ href: `/${locale}/finance/journal`, icon: "book" as const, label: t("newJournal") }] : []),
  ];

  const navLink = (i: NavItem) => {
    const on = isActive(i);
    return (
      <Link
        key={i.key}
        href={`/${locale}${i.href}`}
        aria-current={on ? "page" : undefined}
        className={`group flex items-center gap-3 rounded-[10px] px-3 py-2 text-[14px] font-semibold no-underline transition-colors duration-150 ${on ? "bg-white text-primary-700 shadow-[0_1px_2px_rgb(60_45_20/0.06)] ring-1 ring-slate-200" : "text-slate-700 hover:bg-[#e9e3d9] hover:text-slate-900"}`}
      >
        <Icon name={i.icon} className={on ? "text-primary-500" : "text-slate-400 transition-colors group-hover:text-slate-600"} />
        <span className="min-w-0 truncate">{nl(i.key)}</span>
        {!!i.count && <span className="ms-auto rounded-full bg-amber-50 px-2 text-[12px] font-extrabold leading-5 text-amber-600">{i.count}</span>}
      </Link>
    );
  };
  const showCrumbs = crumbs.length > 0 && (crumb || subPage[path]);

  return (
    <div className="app-shell flex min-h-screen">
      <input type="checkbox" id="nav-toggle" className="peer sr-only" aria-hidden="true" tabIndex={-1} />
      <aside className="fixed inset-y-0 start-0 z-50 flex w-[var(--sidebar-w)] flex-col border-e border-[#e3dbcf] bg-linen transition-transform duration-200 max-lg:invisible max-lg:-translate-x-full max-lg:rtl:translate-x-full peer-checked:visible peer-checked:translate-x-0 lg:sticky lg:top-0 lg:h-screen">
        <Link href={`/${locale}`} className="flex items-center gap-3 px-6 pt-6 pb-5 no-underline">
          <span className="grid size-10 place-items-center rounded-xl bg-primary-500 text-petro-100">
            <svg viewBox="0 0 24 24" className="size-5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3c3 4 6 7 6 10.5A6 6 0 0 1 6 13.5C6 10 9 7 12 3z" /><path d="M8.5 15.5c1 1.2 2.2 1.8 3.5 1.8" /></svg>
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[16.5px] font-extrabold text-slate-900">{app("brand")}</span>
            <span className="block text-[12.5px] font-semibold text-slate-500">{app("tagline")}</span>
          </span>
        </Link>
        <div className="px-4">
          <NewMenu label={t("newMenu")} items={newItems} />
        </div>
        <nav className="flex-1 overflow-y-auto px-4 pb-4 [scrollbar-width:thin]" aria-label={t("menu")}>
          {groups.map((g, gi) => {
            const items = g.items.filter((i) => i.show);
            if (!items.length) return null;
            return (
              <div key={gi} className={g.label ? "mt-5" : "mt-2"}>
                {g.label && <div className="nav-group-label px-3 pb-1.5 text-[11.5px] font-extrabold uppercase tracking-[0.08em] text-slate-400">{g.label}</div>}
                <div className="grid gap-0.5">{items.map(navLink)}</div>
              </div>
            );
          })}
        </nav>
        <div className="m-4 mt-0 flex items-center gap-3 rounded-2xl border border-[#e3dbcf] bg-[#f7f3ed] p-3">
          <span className="avatar">{initials(userName)}</span>
          <span className="min-w-0 flex-1 leading-snug">
            <span className="block truncate text-[14px] font-bold text-slate-900">{userName}</span>
            <span className="block truncate text-[12.5px] text-slate-500">{roleLabel || app("tagline")}</span>
          </span>
          <form action={signOut.bind(null, locale)}>
            <button type="submit" className="ghost icon-btn" title={t("signOut")} aria-label={t("signOut")}><Icon name="logout" size={17} /></button>
          </form>
        </div>
      </aside>
      <label htmlFor="nav-toggle" className="fixed inset-0 z-40 hidden bg-slate-900/30 backdrop-blur-[2px] peer-checked:block lg:!hidden" aria-hidden="true" />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="topbar sticky top-0 z-30 flex min-h-[68px] flex-wrap items-center gap-3 border-b border-slate-200 bg-[#f8f5f0]/90 px-4 py-3 backdrop-blur-md sm:px-8">
          <label htmlFor="nav-toggle" className="btn ghost icon-btn lg:!hidden" aria-label={t("menu")}><Icon name="menu" /></label>
          <SearchBox action={`/${locale}/search`} label={t("search")} placeholder={t("searchPlaceholder")} />
          <div className="ms-auto flex items-center gap-2.5">
            <div className="flex items-center rounded-full bg-linen p-[3px]" role="group" aria-label={t("language")}>
              {routing.locales.map((l) => (
                <Link
                  key={l}
                  href={`/${l}${path}`}
                  lang={l}
                  aria-current={l === locale ? "true" : undefined}
                  className={`rounded-full px-3 py-1 text-[13px] font-bold no-underline transition-colors ${l === locale ? "bg-white text-slate-900 shadow-[0_1px_2px_rgb(60_45_20/0.08)]" : "text-slate-500 hover:text-slate-900"}`}
                >
                  {LANG_NAMES[l]}
                </Link>
              ))}
            </div>
            <Notifications items={notifications} label={t("notifications")} empty={t("noNotifications")} />
          </div>
        </header>
        <main className={`mx-auto w-full flex-1 px-4 pt-7 pb-16 sm:px-8 ${wide ? "max-w-[1560px]" : "max-w-[1280px]"}`}>
          {showCrumbs && (
            <nav aria-label={t("breadcrumbs")} className="no-print mb-3">
              <ol className="m-0 flex list-none flex-wrap items-center gap-2 p-0 text-[13.5px] font-semibold text-slate-500">
                {crumbs.map((c, i) => (
                  <li key={i} className="flex items-center gap-2">
                    {i > 0 && <span className="text-slate-300">/</span>}
                    {c.href && i < crumbs.length - 1 ? <Link href={c.href} className="text-slate-500 hover:text-slate-900">{c.label}</Link> : <span className={i === crumbs.length - 1 ? "text-slate-900" : ""}>{c.label}</span>}
                  </li>
                ))}
              </ol>
            </nav>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
