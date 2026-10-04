import { eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { Icon, type IconName } from "@/components/icons";
import { Amounts, Card, EmptyState, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { exceptions } from "@/domain/management/exceptions";
import { describe, formatMoney, intlLocale } from "@/lib/format";
import { can } from "@/server/authz";
import { activeJobs, dashboardKpis } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "./shell";

export const dynamic = "force-dynamic";

/** Where an exception points to, so the user can act on it in one click. */
function entityHref(locale: string, e: { type: string; id: string }) {
  const map: Record<string, string> = {
    job: `/jobs/${e.id}`,
    invoice: `/finance/invoices/${e.id}`,
    pay_statement: `/statements/${e.id}`,
    money_account: "/finance/accounts",
    approvals: "/approvals",
    documents: "/documents",
  };
  return map[e.type] ? `/${locale}${map[e.type]}` : null;
}
const SEVERITY_ICON: Record<string, IconName> = { critical: "alert", warning: "alert", info: "info" };

export default async function Dashboard({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const t = await getTranslations({ locale, namespace: "Dashboard" });
  const st = await getTranslations({ locale, namespace: "JobStatus" });
  const codes = await getTranslations({ locale, namespace: "Codes" });
  const today = new Date().toISOString().slice(0, 10);
  const [alerts, jobList, kpi] = await Promise.all([exceptions(db, actor.companyId, today), activeJobs(db, actor), dashboardKpis(db, actor)]);
  const m = (a: string, c: string) => formatMoney(a, c, locale);
  const dateLine = new Intl.DateTimeFormat(intlLocale(locale), { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());

  const hour = new Date().getHours();
  const greeting = t(hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening", { name: user.displayName.split(" ")[0] });
  const goTo = [
    { show: can(actor, "jobs.view"), href: `/${locale}/documents`, icon: "file" as IconName, label: t("goDocuments"), tone: "bg-sky-50 text-sky-600" },
    { show: can(actor, "settlements.create"), href: `/${locale}/statements`, icon: "truck" as IconName, label: t("goPay"), tone: "bg-primary-50 text-primary-500" },
    { show: can(actor, "reports.financial.view") || can(actor, "invoices.create"), href: `/${locale}/finance`, icon: "receipt" as IconName, label: t("goInvoices"), tone: "bg-petro-50 text-petro-600" },
    { show: can(actor, "reports.financial.view"), href: `/${locale}/reports?tab=pl`, icon: "chart" as IconName, label: t("goProfit"), tone: "bg-emerald-50 text-emerald-600" },
  ].filter((g) => g.show);

  return (
    <Shell permissions={actor.permissions} locale={locale} userName={user.displayName} path="">
      <PageHeader
        eyebrow={dateLine}
        title={greeting}
        subtitle={t("summary", { jobs: kpi.activeJobs, trucks: kpi.inTransit, waiting: alerts.length })}
        actions={can(actor, "jobs.create") && <Link href={`/${locale}/jobs/new`} className="btn primary"><Icon name="plus" />{t("newJob")}</Link>}
      />

      <div className="stats">
        {kpi.money && (
          <>
            <Stat label={t("kpiCash")} value={<Amounts values={kpi.money.cash} format={m} />} icon="bank" href={`/${locale}/finance/accounts`} />
            <Stat label={t("kpiOwedToUs")} value={<Amounts values={kpi.money.owedToUs} format={m} />} icon="trendingUp" tone="success" href={`/${locale}/finance/partners`} />
            <Stat label={t("kpiWeOwe")} value={<Amounts values={kpi.money.weOwe} format={m} />} icon="wallet" tone="warning" href={`/${locale}/finance/partners`} />
          </>
        )}
        <Stat label={t("kpiActiveJobs")} value={kpi.activeJobs} icon="briefcase" href={`/${locale}/jobs`} hint={t("trucksOnRoad", { count: kpi.inTransit })} />
      </div>

      <div className="grid cols-2">
        <Card title={t("attention")} subtitle={t("attentionHint")} flush actions={alerts.length > 0 && <span className="badge warning plain">{alerts.length}</span>}>
          {alerts.length === 0 ? (
            <EmptyState icon="checkCircle" title={t("allClear")} />
          ) : (
            <ul className="alerts">
              {alerts.map((a, i) => {
                const href = entityHref(locale, a.entity);
                const text = describe(codes, a.code, a.params, a.message, locale);
                return (
                  <li key={i} className={a.severity}>
                    <span className="alert-icon"><Icon name={SEVERITY_ICON[a.severity]} size={17} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold">{href ? <Link href={href} className="!text-slate-900 hover:!text-primary-500">{text}</Link> : text}</div>
                      <div className="ltr text-[13px] text-slate-500">{a.entity.label}</div>
                    </div>
                    {href && <Link href={href} className="text-[13px] font-bold whitespace-nowrap">{t("open")}</Link>}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title={t("activeJobs")} subtitle={t("activeJobsHint")} flush actions={<Link href={`/${locale}/jobs`} className="text-[13.5px] font-bold">{t("viewAll")}</Link>}>
          {jobList.length === 0 ? (
            <EmptyState icon="briefcase" title={t("noJobs")} action={can(actor, "jobs.create") && <Link href={`/${locale}/jobs/new`} className="btn primary sm"><Icon name="plus" size={15} />{t("newJob")}</Link>} />
          ) : (
            <ul className="m-0 list-none p-0">
              {jobList.slice(0, 8).map(({ job, customer, type, nextAction }) => (
                <li key={job.id} className="border-b border-slate-100 last:border-b-0">
                  <Link href={`/${locale}/jobs/${job.id}`} className="grid gap-1 px-[22px] py-3.5 !text-slate-900 hover:bg-slate-50">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate font-bold">{job.name}</span>
                      <StatusBadge status={job.status} label={st(job.status)} />
                    </span>
                    <span className="truncate text-[13px] text-slate-500"><span className="ltr">{job.jobNo}</span> · {customer} · {type}</span>
                    {nextAction && <span className="flex items-center gap-2 text-[13px] font-semibold text-slate-700"><Icon name="flag" size={14} className="text-petro-500" />{describe(codes, nextAction.code, nextAction.params, nextAction.text, locale)}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {goTo.length > 0 && (
        <section className="mt-2">
          <h2 className="!mt-2">{t("goTo")}</h2>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))" }}>
            {goTo.map((g) => (
              <Link key={g.href} href={g.href} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 font-bold !text-slate-900 shadow-card transition hover:border-primary-200">
                <span className={`grid size-10 place-items-center rounded-[10px] ${g.tone}`}><Icon name={g.icon} /></span>
                {g.label}
              </Link>
            ))}
          </div>
        </section>
      )}
    </Shell>
  );
}
