import { and, eq, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { getDb } from "@/db/client";
import { approvalRequests, documents, roles, userRoles } from "@/db/schema";
import { Icon, type IconName } from "@/components/icons";
import { NavSection } from "@/components/NavSection";
import { type NotificationItem, Notifications } from "@/components/Notifications";
import { initials } from "@/components/ui";
import { routing } from "@/i18n/routing";
import { currentActor } from "@/server/session";
import { signOut } from "./login/actions";

const LANG_NAMES: Record<string, string> = { en: "EN", ar: "العربية", ckb: "کوردی" };

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
  const isActive = (i: NavItem) => (i.exact ? path === i.href || (i.href === "/finance" && path.startsWith("/finance/invoices")) : path === i.href || path.startsWith(`${i.href}/`));

  // Breadcrumbs: section › page › record
  const current = groups.flatMap((g) => g.items.map((i) => ({ g, i }))).find(({ i }) => i.href && isActive(i));
  const subPage: Record<string, string> = { "/jobs/new": t("newJob"), "/admin/audit": t("auditLog") };
  const crumbs: { label: string; href?: string }[] = [];
  if (current) {
    if (current.g.label) crumbs.push({ label: current.g.label });
    crumbs.push({ label: nl(current.i.key), href: `/${locale}${current.i.href}` });
  }
  if (subPage[path]) crumbs.push({ label: subPage[path] });
  if (crumb) crumbs.push({ label: crumb });

  const notifications: NotificationItem[] = [
    ...(pendingApprovals ? [{ href: `/${locale}/approvals`, icon: "checkCircle" as const, title: t("toApprove", { count: pendingApprovals }), tone: "warning" as const }] : []),
    ...(toVerify ? [{ href: `/${locale}/documents`, icon: "file" as const, title: t("toVerify", { count: toVerify }), tone: "info" as const }] : []),
  ];

  const navLink = (i: NavItem) => {
    const on = isActive(i);
    return (
      <Link
        key={i.key}
        href={`/${locale}${i.href}`}
        aria-current={on ? "page" : undefined}
        className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium no-underline transition-all duration-150 ${on ? "bg-primary-500/15 text-white ring-1 ring-inset ring-primary-400/25 shadow-[0_1px_12px_-4px] shadow-primary-500/40" : "text-slate-400 hover:bg-white/[0.06] hover:text-slate-100"}`}
      >
        <span className="relative flex">
          <Icon name={i.icon} className={on ? "text-primary-400" : "text-slate-500 transition-colors group-hover:text-slate-300"} />
          {!!i.count && (
            <span className="absolute -top-2 -end-2.5 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-rose-500 px-1 font-mono text-[10px] font-semibold leading-none text-white shadow-md shadow-rose-950/40 ring-2 ring-ink-900">{i.count}</span>
          )}
        </span>
        <span className="truncate">{nl(i.key)}</span>
        {on && <span className="ms-auto size-1.5 rounded-full bg-primary-400 shadow-[0_0_8px] shadow-primary-400" />}
      </Link>
    );
  };

  return (
    <div className="app-shell flex min-h-screen">
      <input type="checkbox" id="nav-toggle" className="peer sr-only" aria-hidden="true" tabIndex={-1} />
      <aside className="fixed inset-y-0 start-0 z-50 flex w-[var(--sidebar-w)] flex-col border-e border-white/[0.06] bg-ink-900 bg-[radial-gradient(120%_60%_at_0%_0%,rgb(59_130_246/0.10),transparent_60%),linear-gradient(180deg,var(--color-ink-900),var(--color-ink-950))] text-slate-300 transition-transform duration-200 max-lg:invisible max-lg:-translate-x-full max-lg:rtl:translate-x-full peer-checked:visible peer-checked:translate-x-0 lg:sticky lg:top-0 lg:h-screen">
        <Link href={`/${locale}`} className="flex items-center gap-3 px-5 pt-5 pb-4 no-underline">
          <span className="grid size-9 place-items-center rounded-[10px] bg-gradient-to-br from-primary-500 to-petro-500 text-base font-bold text-white shadow-lg shadow-primary-500/30 ring-1 ring-white/20">E</span>
          <span className="min-w-0">
            <span className="block truncate text-[14.5px] font-semibold leading-tight text-white">{app("title")}</span>
            <span className="block text-[11px] tracking-wide text-slate-500">{app("tagline")}</span>
          </span>
        </Link>
        <div className="mx-5 mb-1 h-px bg-gradient-to-r from-white/10 via-white/[0.06] to-transparent" />
        <nav className="flex-1 overflow-y-auto px-3 pt-3 pb-4 [scrollbar-width:thin]">
          {groups.map((g, gi) => {
            const items = g.items.filter((i) => i.show);
            if (!items.length) return null;
            if (!g.label) return <div key={gi} className="grid gap-0.5">{items.map(navLink)}</div>;
            return (
              <NavSection key={gi} id={String(gi)} label={g.label} active={items.some(isActive)}>
                {items.map(navLink)}
              </NavSection>
            );
          })}
        </nav>
        <div className="m-3 flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.04] p-2.5">
          <span className="avatar !size-9 ring-2 ring-white/10">{initials(userName)}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-white">{userName}</span>
            <span className="block truncate text-[11.5px] text-slate-500">{roleLabel || app("tagline")}</span>
          </span>
          <form action={signOut.bind(null, locale)}>
            <button type="submit" className="ghost icon-btn !text-slate-400 hover:!bg-white/10 hover:!text-white" title={t("signOut")} aria-label={t("signOut")}><Icon name="logout" size={17} /></button>
          </form>
        </div>
      </aside>
      <label htmlFor="nav-toggle" className="fixed inset-0 z-40 hidden bg-slate-950/50 backdrop-blur-[2px] peer-checked:block lg:!hidden" aria-hidden="true" />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="topbar sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200/80 bg-white/80 px-4 backdrop-blur-md sm:px-6">
          <label htmlFor="nav-toggle" className="btn ghost icon-btn lg:!hidden" aria-label={t("menu")}><Icon name="menu" /></label>
          <nav aria-label={t("breadcrumbs")} className="min-w-0 flex-1">
            <ol className="m-0 flex min-w-0 list-none items-center gap-1.5 p-0 text-[13px]">
              <li className="flex flex-none">
                <Link href={`/${locale}`} className="grid size-7 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={nl("dashboard")}><Icon name="home" size={16} /></Link>
              </li>
              {crumbs.map((c, i) => (
                <li key={i} className={`flex min-w-0 items-center gap-1.5 ${i < crumbs.length - 1 ? "max-sm:hidden" : ""}`}>
                  <Icon name="chevronRight" size={14} className="flex-none text-slate-300" />
                  {c.href && i < crumbs.length - 1 ? (
                    <Link href={c.href} className="truncate font-medium text-slate-500 hover:text-slate-900">{c.label}</Link>
                  ) : (
                    <span className={`truncate ${i === crumbs.length - 1 ? "font-semibold text-slate-900" : "font-medium text-slate-400"}`}>{c.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
          <div className="flex items-center rounded-full border border-slate-200 bg-slate-50 p-0.5" role="group" aria-label={t("language")}>
            <Icon name="globe" size={15} className="mx-1.5 text-slate-400 max-sm:hidden" />
            {routing.locales.map((l) => (
              <Link
                key={l}
                href={`/${l}${path}`}
                lang={l}
                aria-current={l === locale ? "true" : undefined}
                className={`rounded-full px-2.5 py-1 text-[12px] font-semibold no-underline transition-all ${l === locale ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-900"}`}
              >
                {LANG_NAMES[l]}
              </Link>
            ))}
          </div>
          <Notifications items={notifications} label={t("notifications")} empty={t("noNotifications")} />
          <div className="flex items-center gap-2.5 border-s border-slate-200 ps-3">
            <span className="avatar">{initials(userName)}</span>
            <span className="hidden min-w-0 leading-tight md:block">
              <span className="block max-w-40 truncate text-[13px] font-semibold text-slate-900">{userName}</span>
              <span className="block max-w-40 truncate text-[11.5px] text-slate-500">{roleLabel}</span>
            </span>
          </div>
        </header>
        <main className={`mx-auto w-full flex-1 px-4 pt-6 pb-16 sm:px-6 lg:pt-8 ${wide ? "max-w-[1560px]" : "max-w-[1280px]"}`}>{children}</main>
      </div>
    </div>
  );
}
