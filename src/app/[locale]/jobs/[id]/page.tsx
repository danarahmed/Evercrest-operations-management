import { eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { describe, formatMoney, formatQty } from "@/lib/format";
import { jobWorkspace } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../../shell";

export const dynamic = "force-dynamic";

export default async function JobPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const w = await jobWorkspace(db, actor, id);
  const t = await getTranslations({ locale, namespace: "Job" });
  const st = await getTranslations({ locale, namespace: "JobStatus" });
  const ts = await getTranslations({ locale, namespace: "TripStatus" });
  const ds = await getTranslations({ locale, namespace: "DocState" });
  const codes = await getTranslations({ locale, namespace: "Codes" });
  const caps = w.job.capabilities as string[];

  return (
    <Shell locale={locale} userName={user.displayName} path={`/jobs/${id}`}>
      <p><Link href={`/${locale}`}>{t("back")}</Link></p>
      <div className="card">
        <h1>{w.job.jobNo} · {w.job.name}</h1>
        <p className="muted">{w.customer} · <span className="badge">{st(w.job.status)}</span></p>
        <p>{t("nextAction")}: <span className="next">{w.nextAction ? describe(codes, w.nextAction.code, w.nextAction.params, w.nextAction.text, locale) : t("none")}</span></p>
      </div>

      {(caps.includes("transportation") || w.trips.length > 0) && (
        <>
          <h2>{t("trips")}</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>{t("trip")}</th><th>{t("driver")}</th><th>{t("truck")}</th><th>{t("loaded")}</th><th>{t("discharged")}</th><th>{t("difference")}</th><th>{t("advances")}</th><th /></tr>
              </thead>
              <tbody>
                {w.trips.map(({ trip, driver, plate, difference, advances }) => (
                  <tr key={trip.id}>
                    <td>{trip.tripNo}</td>
                    <td>{driver}</td>
                    <td dir="ltr">{plate}</td>
                    <td className="num">{trip.loadedQty ? formatQty(trip.loadedQty, trip.loadedUnit!, locale) : <span className="state-missing">{t("missing")}</span>}</td>
                    <td className="num">{trip.dischargedQty ? formatQty(trip.dischargedQty, trip.dischargedUnit!, locale) : <span className="muted">—</span>}</td>
                    <td className="num">
                      {difference.status === "known" ? formatQty(difference.difference, difference.unit, locale) : difference.status === "incomparable" ? t("notComparable") : <span className="muted">—</span>}
                    </td>
                    <td className="num">{Object.entries(advances).map(([cur, amt]) => <div key={cur}>{formatMoney(amt, cur, locale)}</div>)}</td>
                    <td><span className="badge">{ts(trip.status)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {w.documents.length > 0 && (
        <>
          <h2>{t("documents")}</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t("document")}</th><th>{t("for")}</th><th>{t("state")}</th></tr></thead>
              <tbody>
                {w.documents.map((d) => (
                  <tr key={`${d.documentTypeId}-${d.target.id}`}>
                    <td>{d.documentType}</td>
                    <td>{d.target.label}</td>
                    <td className={`state-${d.state}`}>{ds(d.state)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {w.profitability && (
        <>
          <h2>{t("profit")}</h2>
          {w.profitability.length === 0 ? (
            <p className="card muted">{t("noMoney")}</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>{t("currency")}</th><th>{t("revenue")}</th><th>{t("costs")}</th><th>{t("profitCol")}</th></tr></thead>
                <tbody>
                  {w.profitability.map((p) => (
                    <tr key={p.currency}>
                      <td>{p.currency}</td>
                      <td className="num">{formatMoney(p.revenue, p.currency, locale)}</td>
                      <td className="num">{formatMoney(p.costs, p.currency, locale)}</td>
                      <td className="num"><strong>{formatMoney(p.profit, p.currency, locale)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Shell>
  );
}
