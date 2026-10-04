import { eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { Icon, type IconName } from "@/components/icons";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { globalSearch } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../shell";

export const dynamic = "force-dynamic";

/** Results of the search box at the top of every page, grouped by kind of record. */
export default async function Search({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ q?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const q = ((await searchParams).q ?? "").trim();
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const t = await getTranslations({ locale, namespace: "Search" });
  const js = await getTranslations({ locale, namespace: "JobStatus" });
  const ts = await getTranslations({ locale, namespace: "TripStatus" });
  const lib = await getTranslations({ locale, namespace: "Library" });
  const r = await globalSearch(db, actor, q);
  const m = (a: string, c: string) => formatMoney(a, c, locale);
  const total = r ? r.jobs.length + r.trips.length + r.invoices.length + r.statements.length + r.partners.length + r.documents.length : 0;

  const group = (title: string, icon: IconName, rows: { key: string; href: string | null; title: ReactNode; sub: ReactNode; end?: ReactNode }[]) =>
    rows.length === 0 ? null : (
      <Card flush title={title} icon={icon} actions={<span className="tab-count">{rows.length}</span>}>
        <ul className="m-0 list-none p-0">
          {rows.map((x) => {
            const body = (
              <>
                <span className="grid min-w-0 flex-1">
                  <span className="truncate font-bold text-slate-900">{x.title}</span>
                  <span className="truncate text-[13px] text-slate-500">{x.sub}</span>
                </span>
                {x.end}
                {x.href && <Icon name="chevronRight" size={16} className="flip text-slate-300" />}
              </>
            );
            return (
              <li key={x.key} className="border-b border-slate-100 last:border-b-0">
                {x.href ? <Link href={x.href} className="flex items-center gap-3 px-[22px] py-3 text-slate-900 hover:bg-slate-50">{body}</Link> : <div className="flex items-center gap-3 px-[22px] py-3">{body}</div>}
              </li>
            );
          })}
        </ul>
      </Card>
    );

  return (
    <Shell permissions={actor.permissions} locale={locale} userName={user.displayName} path={`/search?q=${encodeURIComponent(q)}`}>
      <PageHeader title={q ? t("resultsFor", { q }) : t("title")} subtitle={r ? t("found", { count: total }) : t("hint")} />
      {r && total === 0 && <Card><EmptyState icon="search" title={t("nothing")} hint={t("nothingHint")} /></Card>}
      {r && (
        <div className="grid cols-2">
          {group(t("jobs"), "briefcase", r.jobs.map((j) => ({ key: j.id, href: `/${locale}/jobs/${j.id}`, title: j.name, sub: <><span className="ltr">{j.no}</span> · {j.customer}</>, end: <StatusBadge status={j.status} label={js(j.status)} /> })))}
          {group(t("trips"), "truck", r.trips.map((x) => ({ key: x.id, href: `/${locale}/jobs/${x.jobId}?tab=trips`, title: <span className="ltr">{x.no}</span>, sub: <>{x.driver} · <span className="ltr">{x.plate}</span></>, end: <StatusBadge status={x.status} label={ts(x.status)} /> })))}
          {group(t("invoices"), "receipt", r.invoices.map((x) => ({ key: x.id, href: `/${locale}/finance/invoices/${x.id}`, title: <span className="ltr">{x.no}</span>, sub: <>{x.kind === "sales" ? t("salesInvoice") : t("bill")} · {x.partner}</>, end: <span className="font-bold tabular-nums">{m(x.total, x.currency)}</span> })))}
          {group(t("statements"), "users", r.statements.map((x) => ({ key: x.id, href: `/${locale}/statements/${x.id}`, title: <span className="ltr">{x.no}</span>, sub: t(`party_${x.party}`), end: <span className="font-bold tabular-nums">{m(x.total, x.currency)}</span> })))}
          {group(t("partners"), "wallet", r.partners.map((x) => ({ key: x.id, href: r.partnerLink ? `/${locale}/finance/partners/${x.id}` : `/${locale}/setup?tab=partners`, title: x.name, sub: x.phone ? <span className="ltr">{x.phone}</span> : "—" })))}
          {group(t("documents"), "file", r.documents.map((x) => ({ key: x.id, href: x.jobId ? `/${locale}/jobs/${x.jobId}?tab=documents` : `/${locale}/documents`, title: <>{x.type}{x.reference && <> · <span className="ltr">{x.reference}</span></>}</>, sub: x.jobNo ? <span className="ltr">{x.jobNo}</span> : "—", end: <StatusBadge status={x.status === "received" ? "awaiting_verification" : x.status} label={lib(`doc_${x.status}`)} /> })))}
        </div>
      )}
    </Shell>
  );
}
