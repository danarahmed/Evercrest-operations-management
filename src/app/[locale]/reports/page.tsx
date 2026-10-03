import { eq } from "drizzle-orm";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { PrintButton } from "@/components/PrintButton";
import { dec } from "@/domain/money";
import { formatMoney } from "@/lib/format";
import { reportsData } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../shell";

export const dynamic = "force-dynamic";

/** Management reports: job profitability, monthly results, and work waiting. Currencies are never added together. */
export default async function Reports({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ from?: string; to?: string; customer?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const t = await getTranslations({ locale, namespace: "Reports" });
  const st = await getTranslations({ locale, namespace: "JobStatus" });
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const from = sp.from ?? `${today.slice(0, 4)}-01-01`;
  const to = sp.to ?? today;
  const r = await reportsData(db, actor, { from, to, customerId: sp.customer || undefined });
  const m = (a: string, c: string) => formatMoney(a, c, locale);
  const pct = (x: string | null) => (x === null ? "—" : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Number(x))}%`);
  const neg = (x: string) => (dec(x).lt(0) ? "state-missing" : "");

  return (
    <Shell wide permissions={actor.permissions} locale={locale} userName={user.displayName} path="/reports">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>{t("title")}</h1>
        <PrintButton label={t("print")} />
      </div>
      <form className="row no-print" method="get">
        <label>{t("from")} <input type="date" name="from" defaultValue={from} /></label>
        <label>{t("to")} <input type="date" name="to" defaultValue={to} /></label>
        <label>{t("customer")} <select name="customer" defaultValue={sp.customer ?? ""}><option value="">{t("allCustomers")}</option>{r.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <button type="submit">{t("show")}</button>
      </form>

      <h2>{t("jobProfit")}</h2>
      <p className="muted">{t("jobProfitHelp")}</p>
      {r.jobs.length === 0 ? <p className="card muted">{t("noData")}</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>{t("job")}</th><th>{t("customer")}</th><th>{t("status")}</th><th>{t("currency")}</th><th className="num">{t("revenue")}</th><th className="num">{t("costs")}</th><th className="num">{t("profit")}</th><th className="num">{t("margin")}</th></tr></thead>
          <tbody>
            {r.jobs.map((j) => (
              <tr key={`${j.jobId}${j.currency}`}>
                <td><Link href={`/${locale}/jobs/${j.jobId}`} dir="ltr">{j.jobNo}</Link> <span className="muted">{j.name}</span></td>
                <td>{j.customer}</td><td><span className="badge">{st(j.status)}</span></td><td>{j.currency}</td>
                <td className="num">{m(j.revenue, j.currency)}</td><td className="num">{m(j.costs, j.currency)}</td>
                <td className={`num ${neg(j.profit)}`}><strong>{m(j.profit, j.currency)}</strong></td><td className={`num ${neg(j.profit)}`}>{pct(j.marginPct)}</td>
              </tr>
            ))}
            {r.totals.map((x) => (
              <tr key={x.currency} className="subtotal">
                <td colSpan={3}><strong>{t("total")}</strong></td><td>{x.currency}</td>
                <td className="num"><strong>{m(x.revenue, x.currency)}</strong></td><td className="num"><strong>{m(x.costs, x.currency)}</strong></td>
                <td className={`num ${neg(x.profit)}`}><strong>{m(x.profit, x.currency)}</strong></td><td className="num">{pct(x.marginPct)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

      <h2>{t("monthly")}</h2>
      <p className="muted">{t("monthlyHelp")}</p>
      {r.monthly.length === 0 ? <p className="card muted">{t("noData")}</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>{t("month")}</th><th>{t("currency")}</th><th className="num">{t("revenue")}</th><th className="num">{t("costs")}</th><th className="num">{t("profit")}</th><th className="num">{t("margin")}</th></tr></thead>
          <tbody>{r.monthly.map((x) => (
            <tr key={`${x.month}${x.currency}`}>
              <td dir="ltr">{x.month}</td><td>{x.currency}</td>
              <td className="num">{m(x.revenue, x.currency)}</td><td className="num">{m(x.costs, x.currency)}</td>
              <td className={`num ${neg(x.profit)}`}><strong>{m(x.profit, x.currency)}</strong></td><td className="num">{pct(x.marginPct)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}

      <div className="grid2">
        <div>
          <h2>{t("unsettled", { count: r.queues.unsettled.length })}</h2>
          {r.queues.unsettled.length === 0 ? <p className="card muted">{t("allDone")}</p> : (
            <div className="table-wrap"><table>
              <thead><tr><th>{t("trip")}</th><th>{t("job")}</th><th>{t("driver")}</th><th>{t("discharged")}</th></tr></thead>
              <tbody>{r.queues.unsettled.map((q) => (
                <tr key={q.tripId}><td dir="ltr">{q.tripNo}</td><td><Link href={`/${locale}/jobs/${q.jobId}`} dir="ltr">{q.jobNo}</Link></td><td>{q.driver}</td><td>{q.dischargeDate}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
        <div>
          <h2>{t("unbilled", { count: r.queues.unbilled.length })}</h2>
          {r.queues.unbilled.length === 0 ? <p className="card muted">{t("allDone")}</p> : (
            <div className="table-wrap"><table>
              <thead><tr><th>{t("trip")}</th><th>{t("job")}</th><th>{t("customer")}</th><th>{t("discharged")}</th></tr></thead>
              <tbody>{r.queues.unbilled.map((q) => (
                <tr key={q.tripId}><td dir="ltr">{q.tripNo}</td><td><Link href={`/${locale}/jobs/${q.jobId}`} dir="ltr">{q.jobNo}</Link></td><td>{q.customer}</td><td>{q.dischargeDate}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      </div>
    </Shell>
  );
}
