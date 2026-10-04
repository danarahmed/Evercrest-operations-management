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

  return (
    <Shell permissions={actor.permissions} locale={locale} userName={user.displayName} path="">
      <PageHeader
        title={t("welcome", { name: user.displayName })}
        subtitle={dateLine}
        actions={can(actor, "jobs.create") && <Link href={`/${locale}/jobs/new`} className="btn primary"><Icon name="plus" />{t("newJob")}</Link>}
      />

      <div className="stats">
        <Stat label={t("kpiActiveJobs")} value={kpi.activeJobs} icon="briefcase" href={`/${locale}/jobs`} />
        <Stat label={t("kpiInTransit")} value={kpi.inTransit} icon="truck" tone="violet" />
        {kpi.money && (
          <>
            <Stat label={t("kpiCash")} value={<Amounts values={kpi.money.cash} format={m} />} icon="bank" tone="success" href={`/${locale}/finance/accounts`} />
            <Stat label={t("kpiOwedToUs")} value={<Amounts values={kpi.money.owedToUs} format={m} />} icon="trendingUp" href={`/${locale}/finance/partners`} />
            <Stat label={t("kpiWeOwe")} value={<Amounts values={kpi.money.weOwe} format={m} />} icon="wallet" tone="warning" href={`/${locale}/finance/partners`} />
          </>
        )}
      </div>

      <div className="grid side">
        <Card
          title={t("activeJobs")}
          icon="briefcase"
          flush
          actions={<Link href={`/${locale}/jobs`} className="btn ghost sm">{t("viewAll")}<Icon name="chevronRight" size={15} /></Link>}
        >
          {jobList.length === 0 ? (
            <EmptyState icon="briefcase" title={t("noJobs")} action={can(actor, "jobs.create") && <Link href={`/${locale}/jobs/new`} className="btn primary sm"><Icon name="plus" size={15} />{t("newJob")}</Link>} />
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>{t("job")}</th><th>{t("status")}</th><th>{t("nextAction")}</th></tr></thead>
                <tbody>
                  {jobList.slice(0, 10).map(({ job, customer, type, nextAction }) => (
                    <tr key={job.id}>
                      <td className="wrap">
                        <Link href={`/${locale}/jobs/${job.id}`} className="cell-title">{job.name}</Link>
                        <div className="cell-sub"><span className="ltr">{job.jobNo}</span> · {customer} · {type}</div>
                      </td>
                      <td><StatusBadge status={job.status} label={st(job.status)} /></td>
                      <td className="next wrap">{nextAction ? describe(codes, nextAction.code, nextAction.params, nextAction.text, locale) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title={t("attention")} icon="flag" flush subtitle={alerts.length ? t("attentionCount", { count: alerts.length }) : undefined}>
          {alerts.length === 0 ? (
            <EmptyState icon="checkCircle" title={t("allClear")} />
          ) : (
            <ul className="alerts">
              {alerts.map((a, i) => {
                const href = entityHref(locale, a.entity);
                const text = describe(codes, a.code, a.params, a.message, locale);
                return (
                  <li key={i} className={a.severity}>
                    <span className="alert-icon"><Icon name={SEVERITY_ICON[a.severity]} size={16} /></span>
                    <div style={{ minWidth: 0 }}>
                      <div>{href ? <Link href={href} style={{ color: "inherit" }}>{text}</Link> : text}</div>
                      <div className="small muted ltr">{a.entity.label}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </Shell>
  );
}
