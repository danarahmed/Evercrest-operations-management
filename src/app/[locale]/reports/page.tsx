import { eq } from "drizzle-orm";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { Icon } from "@/components/icons";
import { PrintButton } from "@/components/PrintButton";
import { Card, EmptyState, PageHeader, StatusBadge, Tabs } from "@/components/ui";
import { dec } from "@/domain/money";
import { formatMoney, intlLocale } from "@/lib/format";
import { financeReports, reportsData } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../shell";

export const dynamic = "force-dynamic";

type Tab = "jobs" | "monthly" | "pl" | "bs" | "waiting";

/** Management reports from the books. IQD and USD are always shown separately, never added together. */
export default async function Reports({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ from?: string; to?: string; customer?: string; tab?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const t = await getTranslations({ locale, namespace: "Reports" });
  const fin = await getTranslations({ locale, namespace: "Finance" });
  const st = await getTranslations({ locale, namespace: "JobStatus" });
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const from = sp.from ?? `${today.slice(0, 4)}-01-01`;
  const to = sp.to ?? today;
  const tab = (["jobs", "monthly", "pl", "bs", "waiting"].includes(sp.tab ?? "") ? sp.tab : "jobs") as Tab;
  const [r, fr] = await Promise.all([reportsData(db, actor, { from, to, customerId: sp.customer || undefined }), financeReports(db, actor, from, to)]);
  const m = (a: string, c: string) => formatMoney(a, c, locale);
  const pct = (x: string | null) => (x === null ? "—" : `${new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 1 }).format(Number(x))}%`);
  const neg = (x: string) => (dec(x).lt(0) ? "neg" : "");
  const qs = (k: Tab) => `/${locale}/reports?tab=${k}&from=${from}&to=${to}${sp.customer ? `&customer=${sp.customer}` : ""}`;

  return (
    <Shell wide permissions={actor.permissions} locale={locale} userName={user.displayName} path="/reports">
      <PageHeader title={t("title")} subtitle={t("subtitle")} actions={<PrintButton label={t("print")} />} />
      <form className="filters no-print" method="get">
        <input type="hidden" name="tab" value={tab} />
        <label>{t("from")}<input type="date" name="from" defaultValue={from} /></label>
        <label>{t("to")}<input type="date" name="to" defaultValue={to} /></label>
        {tab === "jobs" && <label>{t("customer")}<select name="customer" defaultValue={sp.customer ?? ""}><option value="">{t("allCustomers")}</option>{r.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
        <button type="submit"><Icon name="search" size={16} />{t("show")}</button>
      </form>
      <Tabs active={tab} items={[
        { key: "jobs", label: t("jobProfit"), href: qs("jobs"), icon: "briefcase" },
        { key: "monthly", label: t("monthly"), href: qs("monthly"), icon: "calendar" },
        { key: "pl", label: fin("pl"), href: qs("pl"), icon: "trendingUp" },
        { key: "bs", label: t("balanceSheet"), href: qs("bs"), icon: "bank" },
        { key: "waiting", label: t("waiting"), href: qs("waiting"), icon: "clock", count: r.queues.unsettled.length + r.queues.unbilled.length },
      ]} />

      {tab === "jobs" && (
        <Card flush title={t("jobProfit")} subtitle={t("jobProfitHelp")} icon="briefcase">
          {r.jobs.length === 0 ? <EmptyState icon="chart" title={t("noData")} /> : (
            <div className="table-wrap"><table>
              <thead><tr><th>{t("job")}</th><th>{t("customer")}</th><th>{t("status")}</th><th>{t("currency")}</th><th className="num">{t("revenue")}</th><th className="num">{t("costs")}</th><th className="num">{t("profit")}</th><th className="num">{t("margin")}</th></tr></thead>
              <tbody>
                {r.jobs.map((j) => (
                  <tr key={`${j.jobId}${j.currency}`}>
                    <td className="wrap"><Link href={`/${locale}/jobs/${j.jobId}?tab=money`} className="cell-title">{j.name}</Link><div className="cell-sub ltr">{j.jobNo}</div></td>
                    <td>{j.customer}</td><td><StatusBadge status={j.status} label={st(j.status)} /></td><td>{j.currency}</td>
                    <td className="num">{m(j.revenue, j.currency)}</td><td className="num">{m(j.costs, j.currency)}</td>
                    <td className={`num ${neg(j.profit)}`}><strong>{m(j.profit, j.currency)}</strong></td><td className={`num ${neg(j.profit)}`}>{pct(j.marginPct)}</td>
                  </tr>
                ))}
                {r.totals.map((x) => (
                  <tr key={x.currency} className="subtotal">
                    <td colSpan={3}>{t("total")}</td><td>{x.currency}</td>
                    <td className="num">{m(x.revenue, x.currency)}</td><td className="num">{m(x.costs, x.currency)}</td>
                    <td className={`num ${neg(x.profit)}`}>{m(x.profit, x.currency)}</td><td className="num">{pct(x.marginPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Card>
      )}

      {tab === "monthly" && (
        <Card flush title={t("monthly")} subtitle={t("monthlyHelp")} icon="calendar">
          {r.monthly.length === 0 ? <EmptyState icon="chart" title={t("noData")} /> : (
            <div className="table-wrap"><table>
              <thead><tr><th>{t("month")}</th><th>{t("currency")}</th><th className="num">{t("revenue")}</th><th className="num">{t("costs")}</th><th className="num">{t("profit")}</th><th className="num">{t("margin")}</th></tr></thead>
              <tbody>{r.monthly.map((x) => (
                <tr key={`${x.month}${x.currency}`}>
                  <td className="ltr"><strong>{x.month}</strong></td><td>{x.currency}</td>
                  <td className="num">{m(x.revenue, x.currency)}</td><td className="num">{m(x.costs, x.currency)}</td>
                  <td className={`num ${neg(x.profit)}`}><strong>{m(x.profit, x.currency)}</strong></td><td className="num">{pct(x.marginPct)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      )}

      {tab === "pl" && (
        fr.pl.length === 0 ? <Card><EmptyState icon="chart" title={t("noData")} /></Card> : (
          <div className="grid cols-2">
            {fr.pl.map((p) => (
              <Card key={p.currency} flush title={`${fin("pl")} · ${p.currency}`} icon="trendingUp">
                <div className="table-wrap"><table>
                  <tbody>
                    <tr className="group"><td colSpan={2}>{fin("totalIncome")}</td></tr>
                    {p.income.map((l) => <tr key={l.code}><td>{l.code} · {l.name}</td><td className="num">{m(l.amount, p.currency)}</td></tr>)}
                    <tr className="subtotal"><td>{fin("totalIncome")}</td><td className="num">{m(p.totalIncome, p.currency)}</td></tr>
                    <tr className="group"><td colSpan={2}>{fin("totalExpenses")}</td></tr>
                    {p.expenses.map((l) => <tr key={l.code}><td>{l.code} · {l.name}</td><td className="num">{m(l.amount, p.currency)}</td></tr>)}
                    <tr className="subtotal"><td>{fin("totalExpenses")}</td><td className="num">{m(p.totalExpenses, p.currency)}</td></tr>
                    <tr className="subtotal"><td><strong>{fin("netProfit")}</strong></td><td className={`num ${neg(p.netProfit)}`}><strong>{m(p.netProfit, p.currency)}</strong></td></tr>
                  </tbody>
                </table></div>
              </Card>
            ))}
          </div>
        )
      )}

      {tab === "bs" && (
        <div className="grid cols-2">
          {fr.bs.map((b) => (
            <Card key={b.currency} flush title={`${t("balanceSheet")} · ${b.currency}`} subtitle={fin("bs", { date: to })} icon="bank" actions={b.balanced ? <span className="badge success">✓</span> : <span className="badge danger">{fin("unbalanced")}</span>}>
              <div className="table-wrap"><table>
                <tbody>
                  {b.assets.map((l) => <tr key={l.code}><td>{l.code} · {l.name}</td><td className="num">{m(l.amount, b.currency)}</td></tr>)}
                  <tr className="subtotal"><td>{fin("totalAssets")}</td><td className="num">{m(b.totalAssets, b.currency)}</td></tr>
                  {[...b.liabilities, ...b.equity].map((l) => <tr key={l.code}><td>{l.code} · {l.name}</td><td className="num">{m(l.amount, b.currency)}</td></tr>)}
                  <tr><td>{fin("retainedEarnings")}</td><td className="num">{m(b.retainedEarnings, b.currency)}</td></tr>
                  <tr className="subtotal"><td>{fin("totalLE")}</td><td className="num">{m(b.totalLiabilitiesAndEquity, b.currency)}</td></tr>
                </tbody>
              </table></div>
            </Card>
          ))}
        </div>
      )}

      {tab === "waiting" && (
        <div className="grid cols-2">
          <Card flush title={t("unsettled", { count: r.queues.unsettled.length })} icon="truck">
            {r.queues.unsettled.length === 0 ? <EmptyState icon="checkCircle" title={t("allDone")} /> : (
              <div className="table-wrap"><table>
                <thead><tr><th>{t("trip")}</th><th>{t("job")}</th><th>{t("driver")}</th><th>{t("discharged")}</th></tr></thead>
                <tbody>{r.queues.unsettled.map((q) => (
                  <tr key={q.tripId}><td className="ltr">{q.tripNo}</td><td><Link href={`/${locale}/jobs/${q.jobId}?tab=trips`} className="ltr">{q.jobNo}</Link></td><td>{q.driver}</td><td>{q.dischargeDate}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </Card>
          <Card flush title={t("unbilled", { count: r.queues.unbilled.length })} icon="receipt">
            {r.queues.unbilled.length === 0 ? <EmptyState icon="checkCircle" title={t("allDone")} /> : (
              <div className="table-wrap"><table>
                <thead><tr><th>{t("trip")}</th><th>{t("job")}</th><th>{t("customer")}</th><th>{t("discharged")}</th></tr></thead>
                <tbody>{r.queues.unbilled.map((q) => (
                  <tr key={q.tripId}><td className="ltr">{q.tripNo}</td><td><Link href={`/${locale}/jobs/${q.jobId}?tab=trips`} className="ltr">{q.jobNo}</Link></td><td>{q.customer}</td><td>{q.dischargeDate}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </Card>
        </div>
      )}
    </Shell>
  );
}
