import { eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { describe, formatMoney, formatQty } from "@/lib/format";
import { formOptions, jobHistoryView, jobWorkspace } from "@/server/queries";
import { summarize } from "@/domain/management/history";
import { JobForms } from "./forms";
import { SettlementSection } from "./settlement";
import { ActivitiesSection } from "./activities";
import { DeliveriesSection, WorkOrdersSection } from "./operations";
import { can } from "@/server/authz";
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
  const cap = await getTranslations({ locale, namespace: "Setup" });
  const caps = w.job.capabilities as string[];
  const options = await formOptions(db, actor);
  const history = await jobHistoryView(db, actor, id);
  const dtf = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });

  return (
    <Shell permissions={actor.permissions} locale={locale} userName={user.displayName} path={`/jobs/${id}`}>
      <p><Link href={`/${locale}`}>{t("back")}</Link></p>
      <div className="card">
        <h1>{w.job.jobNo} · {w.job.name}</h1>
        <p className="muted">{w.customer} · {w.meta.type} · <span className="badge">{st(w.job.status)}</span></p>
        <p className="muted">
          {t("responsible")}: {w.meta.responsible} · {t("started")}: {w.job.startDate}
          {w.meta.projectCode && <> · {t("project")}: <span dir="auto">{w.meta.projectCode} {w.meta.project}</span></>}
          {w.meta.contract && <> · {t("contract")}: <span dir="auto">{w.meta.contract} {w.meta.contractTitle}</span></>}
        </p>
        {w.job.description && <p>{w.job.description}</p>}
        <p className="row">{caps.map((c) => <span key={c} className="badge">{cap(`cap_${c}`)}</span>)}</p>
        <p>{t("nextAction")}: <span className="next">{w.nextAction ? describe(codes, w.nextAction.code, w.nextAction.params, w.nextAction.text, locale) : t("none")}</span></p>
      </div>
      {!["financially_closed", "cancelled"].includes(w.job.status) && (
        <JobForms locale={locale} jobId={w.job.id} jobNo={w.job.jobNo} capabilities={caps} tripList={w.trips.map((x) => x.trip)} options={options} />
      )}

<ActivitiesSection locale={locale} jobId={w.job.id} activities={w.activities} users={options.users} editable={can(actor, "jobs.manage") && !["financially_closed", "cancelled"].includes(w.job.status)} />

{caps.includes("field_work") && <WorkOrdersSection locale={locale} jobId={w.job.id} rows={w.workOrders} contractors={options.contractors} editable={can(actor, "jobs.manage") && !["financially_closed", "cancelled"].includes(w.job.status)} />}
      {caps.includes("products") && <DeliveriesSection locale={locale} jobId={w.job.id} rows={w.deliveries} products={options.products} units={options.units} editable={can(actor, "jobs.manage") && !["financially_closed", "cancelled"].includes(w.job.status)} canBill={can(actor, "billing.create") && caps.includes("billing")} />}

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

      <SettlementSection locale={locale} jobId={w.job.id} trips={w.trips} canSettle={can(actor, "settlements.create")} canBill={can(actor, "billing.create") && caps.includes("billing")} />

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

      {w.transactions && (w.transactions.expenses.length > 0 || w.transactions.bills.length > 0 || w.transactions.invoices.length > 0) && (
        <>
          <h2>{t("transactions")}</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t("txDate")}</th><th>{t("txType")}</th><th>{t("txNumber")}</th><th>{t("txDetail")}</th><th>{t("txParty")}</th><th className="num">{t("txAmount")}</th></tr></thead>
              <tbody>
                {w.transactions.invoices.map((x) => (
                  <tr key={x.id} className={x.status !== "posted" ? "muted" : ""}>
                    <td>{x.date}</td><td>{t("txInvoice")}</td><td dir="ltr"><Link href={`/${locale}/finance/invoices/${x.id}`}>{x.no}</Link></td><td>—</td><td>{x.partner}</td>
                    <td className="num">{formatMoney(x.amount, x.currency, locale)}</td>
                  </tr>
                ))}
                {w.transactions.bills.map((x) => (
                  <tr key={x.id} className={x.status !== "posted" ? "muted" : ""}>
                    <td>{x.date}</td><td>{t("txBill")}</td><td dir="ltr"><Link href={`/${locale}/finance/invoices/${x.id}`}>{x.no}</Link></td><td>—</td><td>{x.partner}</td>
                    <td className="num">{formatMoney(`-${x.amount}`, x.currency, locale)}</td>
                  </tr>
                ))}
                {w.transactions.expenses.map((x) => (
                  <tr key={x.id} className={x.status !== "posted" ? "muted" : ""}>
                    <td>{x.date}</td><td>{t("txExpense")}</td><td dir="ltr">{x.no}</td><td>{x.account}{x.notes ? ` · ${x.notes}` : ""}{x.reference ? ` (${x.reference})` : ""}</td><td>{x.partner ?? "—"}</td>
                    <td className="num">{formatMoney(`-${x.amount}`, x.currency, locale)}</td>
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
          {w.breakdown && w.breakdown.length > 0 && (
            <details className="panel">
              <summary>{t("breakdown")}</summary>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>{t("currency")}</th><th>{t("account")}</th><th className="num">{t("revenue")}</th><th className="num">{t("costs")}</th></tr></thead>
                  <tbody>
                    {w.breakdown.map((b) => (
                      <tr key={`${b.code}${b.currency}`}>
                        <td>{b.currency}</td><td>{b.code} · {b.name}</td>
                        <td className="num">{b.type === "income" ? formatMoney(b.amount, b.currency, locale) : ""}</td>
                        <td className="num">{b.type === "expense" ? formatMoney(b.amount, b.currency, locale) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}
      {history.length > 0 && (
        <details className="panel">
          <summary>{t("history")} ({history.length})</summary>
          <div className="table-wrap"><table>
            <tbody>{history.map(({ e, by }) => (
              <tr key={e.id}>
                <td>{dtf.format(e.createdAt)}</td><td>{by ?? "—"}</td><td dir="ltr">{e.action}</td>
                <td className="wrap muted" dir="auto">{summarize(e.after)}</td><td className="wrap">{e.reason ?? ""}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </details>
      )}
    </Shell>
  );
}
