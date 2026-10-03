import { eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { exceptions } from "@/domain/management/exceptions";
import { describe, formatMoney } from "@/lib/format";
import { activeJobs, dashboardKpis } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "./shell";

export const dynamic = "force-dynamic";

export default async function Dashboard({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const t = await getTranslations({ locale, namespace: "Dashboard" });
  const sev = await getTranslations({ locale, namespace: "Severity" });
  const st = await getTranslations({ locale, namespace: "JobStatus" });
  const codes = await getTranslations({ locale, namespace: "Codes" });
  const today = new Date().toISOString().slice(0, 10);
  const [alerts, jobList, kpi] = await Promise.all([exceptions(db, actor.companyId, today), activeJobs(db, actor), dashboardKpis(db, actor)]);
  const money = (x: Record<string, string>) => (Object.keys(x).length ? Object.entries(x).sort(([a], [b]) => a.localeCompare(b)).map(([c, a]) => <div key={c}>{formatMoney(a, c, locale)}</div>) : <div>—</div>);

  return (
    <Shell permissions={actor.permissions} locale={locale} userName={user.displayName} path="">
      <div className="tiles">
        <div className="tile"><span className="muted">{t("kpiActiveJobs")}</span><strong>{kpi.activeJobs}</strong></div>
        <div className="tile"><span className="muted">{t("kpiInTransit")}</span><strong>{kpi.inTransit}</strong></div>
        {kpi.money && (
          <>
            <Link href={`/${locale}/finance/accounts`} className="tile"><span className="muted">{t("kpiCash")}</span><strong>{money(kpi.money.cash)}</strong></Link>
            <Link href={`/${locale}/finance/partners`} className="tile"><span className="muted">{t("kpiOwedToUs")}</span><strong>{money(kpi.money.owedToUs)}</strong></Link>
            <Link href={`/${locale}/finance/partners`} className="tile"><span className="muted">{t("kpiWeOwe")}</span><strong>{money(kpi.money.weOwe)}</strong></Link>
          </>
        )}
      </div>
      <h2>{t("attention")}</h2>
      {alerts.length === 0 ? (
        <p className="card muted">{t("allClear")}</p>
      ) : (
        <ul className="alerts">
          {alerts.map((a, i) => (
            <li key={i} className={`alert ${a.severity}`}>
              <strong>{sev(a.severity)}</strong> · {describe(codes, a.code, a.params, a.message, locale)}
            </li>
          ))}
        </ul>
      )}

      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2>{t("activeJobs")}</h2>
        <Link href={`/${locale}/jobs/new`}>+ {t("newJob")}</Link>
      </div>
      {jobList.length === 0 ? (
        <p className="card muted">{t("noJobs")}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>{t("job")}</th><th>{t("customer")}</th><th>{t("type")}</th><th>{t("status")}</th><th>{t("nextAction")}</th></tr>
            </thead>
            <tbody>
              {jobList.map(({ job, customer, type, nextAction }) => (
                <tr key={job.id}>
                  <td><Link href={`/${locale}/jobs/${job.id}`}>{job.jobNo}</Link> <span className="muted">{job.name}</span></td>
                  <td>{customer}</td>
                  <td>{type}</td>
                  <td><span className="badge">{st(job.status)}</span></td>
                  <td className="next">{nextAction ? describe(codes, nextAction.code, nextAction.params, nextAction.text, locale) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
