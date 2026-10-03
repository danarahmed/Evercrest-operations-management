import { eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { exceptions } from "@/domain/management/exceptions";
import { describe } from "@/lib/format";
import { activeJobs } from "@/server/queries";
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
  const [alerts, jobList] = await Promise.all([exceptions(db, actor.companyId, today), activeJobs(db, actor)]);

  return (
    <Shell permissions={actor.permissions} locale={locale} userName={user.displayName} path="">
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
