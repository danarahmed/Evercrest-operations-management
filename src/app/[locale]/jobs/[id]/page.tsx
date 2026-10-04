import { eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { Icon } from "@/components/icons";
import { Badge, Card, EmptyState, Facts, PageHeader, StatusBadge, Tabs } from "@/components/ui";
import { summarize } from "@/domain/management/history";
import { describe, formatMoney, formatQty, intlLocale } from "@/lib/format";
import { can } from "@/server/authz";
import { formOptions, jobHistoryView, jobWorkspace } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../../shell";
import { ActivitiesSection } from "./activities";
import { CostActions, DocumentAction, JobSettingsActions, TransportActions } from "./forms";
import { DeliveriesSection, WorkOrdersSection } from "./operations";
import { SettlementSection } from "./settlement";

export const dynamic = "force-dynamic";

type TabKey = "overview" | "steps" | "trips" | "work" | "deliveries" | "money" | "documents" | "history";

/**
 * The job workspace (CLAUDE.md §29): one place for everything about a job.
 * It aggregates the underlying records; only tabs relevant to the job are shown.
 */
export default async function JobPage({ params, searchParams }: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ tab?: string }> }) {
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
  const values = w.job.customValues as Record<string, string>;
  const options = await formOptions(db, actor);
  const history = await jobHistoryView(db, actor, id);
  const dtf = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short" });
  const m = (a: string, c: string) => formatMoney(a, c, locale);
  const open = !["financially_closed", "cancelled"].includes(w.job.status);
  const manage = open && can(actor, "jobs.manage");
  const showMoney = !!w.profitability;

  const tabs: { key: TabKey; label: string; show: boolean; count?: number }[] = [
    { key: "overview", label: t("tabOverview"), show: true },
    { key: "steps", label: t("tabSteps"), show: w.activities.length > 0 || manage, count: w.activities.filter((a) => a.a.status === "open").length },
    { key: "trips", label: t("tabTrips"), show: caps.includes("transportation") || w.trips.length > 0, count: w.trips.length },
    { key: "work", label: t("tabWork"), show: caps.includes("field_work"), count: w.workOrders.length },
    { key: "deliveries", label: t("tabDeliveries"), show: caps.includes("products"), count: w.deliveries.length },
    { key: "money", label: t("tabMoney"), show: showMoney },
    { key: "documents", label: t("tabDocuments"), show: w.documents.length > 0 || options.documentTypes.length > 0, count: w.documents.filter((d) => d.state === "missing").length },
    { key: "history", label: t("tabHistory"), show: true },
  ];
  const shown = tabs.filter((x) => x.show);
  const sp = await searchParams;
  const tab = (shown.find((x) => x.key === sp.tab)?.key ?? "overview") as TabKey;
  const base = `/${locale}/jobs/${id}`;
  const nextText = w.nextAction ? describe(codes, w.nextAction.code, w.nextAction.params, w.nextAction.text, locale) : null;
  const toComplete = w.blockers.filter((b) => b.blocks === "completed");
  const toClose = w.blockers.filter((b) => b.blocks === "financially_closed");

  const profitCard = showMoney && (
    <Card title={t("profit")} icon="trendingUp" flush>
      {w.profitability!.length === 0 ? <EmptyState icon="chart" title={t("noMoney")} /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>{t("currency")}</th><th className="num">{t("revenue")}</th><th className="num">{t("costs")}</th><th className="num">{t("profitCol")}</th></tr></thead>
          <tbody>{w.profitability!.map((p) => (
            <tr key={p.currency}>
              <td><strong>{p.currency}</strong></td><td className="num">{m(p.revenue, p.currency)}</td><td className="num">{m(p.costs, p.currency)}</td>
              <td className={`num ${p.profit.startsWith("-") ? "neg" : "money-pos"}`}><strong>{m(p.profit, p.currency)}</strong></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
  );

  return (
    <Shell permissions={actor.permissions} locale={locale} userName={user.displayName} path={`/jobs/${id}`} crumb={w.job.jobNo}>
      <PageHeader
        back={{ href: `/${locale}/jobs`, label: t("backToJobs") }}
        eyebrow={<><span className="ltr">{w.job.jobNo}</span><span>·</span><span>{w.meta.type}</span><StatusBadge status={w.job.status} label={st(w.job.status)} /></>}
        title={w.job.name}
        subtitle={<>{w.customer}{w.meta.projectCode && <> · {w.meta.projectCode} {w.meta.project}</>}</>}
        actions={manage && <JobSettingsActions locale={locale} jobId={w.job.id} capabilities={caps} fields={w.fields} values={values} budget={{ amount: w.job.budgetAmount, currency: w.job.budgetCurrency }} />}
      />

      {nextText && (
        <div className={`banner${w.job.status === "completed" && !toClose.length ? " success" : ""}`}>
          <Icon name="flag" />
          <div>
            <div className="banner-label">{t("nextAction")}</div>
            <div>{nextText}</div>
          </div>
        </div>
      )}

      <Tabs active={tab} items={shown.map((x) => ({ key: x.key, label: x.label, count: x.count, href: x.key === "overview" ? base : `${base}?tab=${x.key}` }))} />

      {tab === "overview" && (
        <div className="grid side">
          <div>
            <Card title={t("details")} icon="briefcase">
              <Facts cols items={[
                [t("customer"), w.customer],
                [t("type"), w.meta.type],
                [t("responsible"), w.meta.responsible],
                [t("started"), w.job.startDate],
                [t("project"), w.meta.projectCode && `${w.meta.projectCode} · ${w.meta.project}`],
                [t("contract"), w.meta.contract && `${w.meta.contract} · ${w.meta.contractTitle}`],
                [t("budget"), w.job.budgetAmount && w.job.budgetCurrency && m(w.job.budgetAmount, w.job.budgetCurrency)],
                ...w.fields.map((f) => [f.label, values[f.key] ?? (f.required ? <span className="neg">{t("missing")}</span> : null)] as [string, React.ReactNode]),
              ]} />
              {w.job.description && <><div className="divider" /><p>{w.job.description}</p></>}
              <div className="divider" />
              <div className="small muted" style={{ marginBlockEnd: 6 }}>{t("parts")}</div>
              <div className="chips">{caps.map((c) => <span key={c} className="chip">{cap(`cap_${c}`)}</span>)}</div>
            </Card>
            {profitCard}
          </div>
          <div>
            <Card title={t("whatRemains")} icon="clipboard" flush>
              {w.blockers.length === 0 ? <EmptyState icon="checkCircle" title={t("nothingRemains")} /> : (
                <ul className="alerts">
                  {[...toComplete, ...toClose].map((b, i) => (
                    <li key={i} className={b.blocks === "completed" ? "warning" : "info"}>
                      <span className="alert-icon"><Icon name={b.blocks === "completed" ? "alert" : "info"} size={15} /></span>
                      <div>
                        <div>{describe(codes, b.code, b.params ?? {}, b.action, locale)}</div>
                        <div className="small muted">{b.blocks === "completed" ? t("blocksCompletion") : t("blocksClose")}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            {w.activities.length > 0 && (
              <Card title={t("tabSteps")} icon="list" actions={<Link href={`${base}?tab=steps`} className="btn ghost sm">{t("open")}<Icon name="chevronRight" size={14} /></Link>}>
                <div className="progress" style={{ marginBlockEnd: 8 }}><span style={{ width: `${Math.round((w.activities.filter((a) => a.a.status !== "open").length / w.activities.length) * 100)}%` }} /></div>
                <div className="small muted">{t("stepsDone", { done: w.activities.filter((a) => a.a.status !== "open").length, total: w.activities.length })}</div>
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === "steps" && <ActivitiesSection locale={locale} jobId={w.job.id} activities={w.activities} users={options.users} editable={manage} />}

      {tab === "trips" && (
        <>
          <Card
            title={t("trips")}
            icon="truck"
            flush
            actions={open && can(actor, "trips.manage") && <TransportActions locale={locale} jobId={w.job.id} jobNo={w.job.jobNo} capabilities={caps} tripList={w.trips.map((x) => x.trip)} options={options} />}
          >
            {w.trips.length === 0 ? <EmptyState icon="truck" title={t("noTrips")} /> : (
              <div className="table-wrap"><table>
                <thead><tr><th>{t("trip")}</th><th>{t("driver")}</th><th>{t("truck")}</th><th className="num">{t("loaded")}</th><th className="num">{t("discharged")}</th><th className="num">{t("difference")}</th><th className="num">{t("advances")}</th><th>{t("state")}</th></tr></thead>
                <tbody>
                  {w.trips.map(({ trip, driver, plate, difference, advances }) => (
                    <tr key={trip.id}>
                      <td className="ltr"><strong>{trip.tripNo}</strong></td>
                      <td>{driver}</td>
                      <td className="ltr">{plate}</td>
                      <td className="num">{trip.loadedQty ? formatQty(trip.loadedQty, trip.loadedUnit!, locale) : <span className="muted">—</span>}</td>
                      <td className="num">{trip.dischargedQty ? formatQty(trip.dischargedQty, trip.dischargedUnit!, locale) : <span className="muted">—</span>}</td>
                      <td className="num">{difference.status === "known" ? formatQty(difference.difference, difference.unit, locale) : difference.status === "incomparable" ? t("notComparable") : <span className="muted">—</span>}</td>
                      <td className="num">{Object.entries(advances).map(([cur, amt]) => <div key={cur}>{m(amt, cur)}</div>)}</td>
                      <td><StatusBadge status={trip.status} label={ts(trip.status)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </Card>
          <SettlementSection locale={locale} jobId={w.job.id} trips={w.trips} canSettle={can(actor, "settlements.create")} canBill={can(actor, "billing.create") && caps.includes("billing")} />
        </>
      )}

      {tab === "work" && <WorkOrdersSection locale={locale} jobId={w.job.id} rows={w.workOrders} contractors={options.contractors} editable={manage} />}

      {tab === "deliveries" && <DeliveriesSection locale={locale} jobId={w.job.id} rows={w.deliveries} products={options.products} units={options.units} editable={manage} canBill={can(actor, "billing.create") && caps.includes("billing")} />}

      {tab === "money" && showMoney && (
        <>
          <div className="stack">
            {profitCard}
            <Card title={t("breakdown")} icon="chart" flush>
              {!w.breakdown?.length ? <EmptyState icon="chart" title={t("noMoney")} /> : (
                <div className="table-wrap"><table>
                  <thead><tr><th>{t("account")}</th><th className="num">{t("revenue")}</th><th className="num">{t("costs")}</th></tr></thead>
                  <tbody>{w.breakdown.map((b) => (
                    <tr key={`${b.code}${b.currency}`}>
                      <td>{b.code} · {b.name} <span className="muted small">{b.currency}</span></td>
                      <td className="num">{b.type === "income" ? m(b.amount, b.currency) : ""}</td>
                      <td className="num">{b.type === "expense" ? m(b.amount, b.currency) : ""}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
            </Card>
          </div>
          <Card
            title={t("transactions")}
            icon="receipt"
            flush
            actions={open && caps.includes("expenses") && can(actor, "payments.create") && <CostActions locale={locale} jobId={w.job.id} jobNo={w.job.jobNo} options={options} />}
          >
            {!w.transactions || (w.transactions.expenses.length + w.transactions.bills.length + w.transactions.invoices.length === 0) ? <EmptyState icon="receipt" title={t("noTransactions")} /> : (
              <div className="table-wrap"><table>
                <thead><tr><th>{t("txDate")}</th><th>{t("txType")}</th><th>{t("txNumber")}</th><th>{t("txDetail")}</th><th>{t("txParty")}</th><th className="num">{t("txAmount")}</th></tr></thead>
                <tbody>
                  {w.transactions.invoices.map((x) => (
                    <tr key={x.id} className={x.status !== "posted" ? "muted" : ""}>
                      <td>{x.date}</td><td><Badge tone="success" plain>{t("txInvoice")}</Badge></td><td className="ltr"><Link href={`/${locale}/finance/invoices/${x.id}`}>{x.no}</Link></td><td>—</td><td>{x.partner}</td>
                      <td className="num money-pos">{m(x.amount, x.currency)}</td>
                    </tr>
                  ))}
                  {w.transactions.bills.map((x) => (
                    <tr key={x.id} className={x.status !== "posted" ? "muted" : ""}>
                      <td>{x.date}</td><td><Badge tone="warning" plain>{t("txBill")}</Badge></td><td className="ltr"><Link href={`/${locale}/finance/invoices/${x.id}`}>{x.no}</Link></td><td>—</td><td>{x.partner}</td>
                      <td className="num">{m(`-${x.amount}`, x.currency)}</td>
                    </tr>
                  ))}
                  {w.transactions.expenses.map((x) => (
                    <tr key={x.id} className={x.status !== "posted" ? "muted" : ""}>
                      <td>{x.date}</td><td><Badge plain>{t("txExpense")}</Badge></td><td className="ltr">{x.no}</td><td className="wrap">{x.account}{x.notes ? ` · ${x.notes}` : ""}{x.reference ? ` (${x.reference})` : ""}</td><td>{x.partner ?? "—"}</td>
                      <td className="num">{m(`-${x.amount}`, x.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </Card>
        </>
      )}

      {tab === "documents" && (
        <Card title={t("documents")} icon="file" flush actions={open && can(actor, "documents.record") && <DocumentAction locale={locale} jobId={w.job.id} tripList={w.trips.map((x) => x.trip)} options={options} />}>
          {w.documents.length === 0 ? <EmptyState icon="file" title={t("noDocumentsRequired")} /> : (
            <div className="table-wrap"><table>
              <thead><tr><th>{t("document")}</th><th>{t("for")}</th><th>{t("state")}</th></tr></thead>
              <tbody>{w.documents.map((d) => (
                <tr key={`${d.documentTypeId}-${d.target.id}`}>
                  <td><strong>{d.documentType}</strong></td><td className="ltr">{d.target.label}</td>
                  <td><StatusBadge status={d.state} label={ds(d.state)} /></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      )}

      {tab === "history" && (
        <Card title={t("history")} icon="history" flush>
          {history.length === 0 ? <EmptyState icon="history" title={t("noHistory")} /> : (
            <div className="table-wrap"><table className="dense">
              <thead><tr><th>{t("when")}</th><th>{t("who")}</th><th>{t("what")}</th><th>{t("detail")}</th></tr></thead>
              <tbody>{history.map(({ e, by }) => (
                <tr key={e.id}>
                  <td>{dtf.format(e.createdAt)}</td><td>{by ?? "—"}</td><td className="ltr">{e.action}</td>
                  <td className="wrap muted" dir="auto">{summarize(e.after)}{e.reason ? <div><em>{e.reason}</em></div> : null}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      )}
    </Shell>
  );
}
