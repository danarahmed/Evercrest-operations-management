import { eq } from "drizzle-orm";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { ActionForm } from "@/components/ActionForm";
import { formatMoney } from "@/lib/format";
import { can } from "@/server/authz";
import { financeOptions, financeReports, openInvoices } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../shell";
import { FinanceNav } from "./nav";

export const dynamic = "force-dynamic";
const LINES = 3;

export default async function Finance({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const t = await getTranslations({ locale, namespace: "Finance" });
  const f = await getTranslations({ locale, namespace: "Forms" });
  const today = new Date().toISOString().slice(0, 10);
  const sp = await searchParams;
  const from = sp.from ?? `${today.slice(0, 7)}-01`;
  const to = sp.to ?? today;
  const canCreate = can(actor, "invoices.create");
  const canView = can(actor, "reports.financial.view");
  const [o, open, reports] = await Promise.all([
    canCreate ? financeOptions(db, actor) : null,
    canView ? openInvoices(db, actor) : null,
    canView ? financeReports(db, actor, from, to) : null,
  ]);
  const k = () => crypto.randomUUID();
  const m = (amount: string, cur: string) => formatMoney(amount, cur, locale);

  return (
    <Shell permissions={actor.permissions} locale={locale} userName={user.displayName} path="/finance">
      <h1>{t("title")}</h1>
      <FinanceNav locale={locale} current="invoices" />

      {o && (
        <details className="panel">
          <summary>{t("newInvoice")}</summary>
          <ActionForm command="invoices.create" locale={locale} idempotencyKey={k()} submitLabel={f("save")}>
            <div className="grid2">
              <label>{t("kind")}
                <select name="kind" required><option value="sales">{t("salesInvoice")}</option><option value="bill">{t("bill")}</option></select>
              </label>
              <label>{t("billFrom")}
                <select name="billFrom" defaultValue=""><option value="">—</option><option value="supplier">{t("supplier")}</option><option value="transporter">{t("transporter")}</option><option value="driver">{t("driver")}</option></select>
              </label>
              <label>{t("partner")}<select name="partnerId" required>{o.partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <label>{t("currency")}<select name="currency" required><option value="USD">USD</option><option value="IQD">IQD</option></select></label>
              <label>{f("date")}<input type="date" name="invoiceDate" required defaultValue={today} /></label>
              <label>{t("dueDate")}<input type="date" name="dueDate" /></label>
              <label>{t("externalRef")}<input name="externalRef" dir="ltr" /></label>
            </div>
            <div className="table-wrap"><table>
              <thead><tr><th>{f("description")}</th><th>{f("quantity")}</th><th>{t("unitPrice")}</th><th>{t("account")}</th><th>{t("job")}</th></tr></thead>
              <tbody>
                {Array.from({ length: LINES }, (_, i) => (
                  <tr key={i}>
                    <td><input name="l_description[]" required={i === 0} /></td>
                    <td><input name="l_quantity[]" inputMode="decimal" dir="ltr" size={6} required={i === 0} /></td>
                    <td><input name="l_unitPrice[]" inputMode="decimal" dir="ltr" size={8} required={i === 0} /></td>
                    <td><select name="l_accountId[]">
                      <optgroup label={t("incomeAccounts")}>{o.incomeAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</optgroup>
                      <optgroup label={t("costAccounts")}>{o.costAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</optgroup>
                    </select></td>
                    <td><select name="l_jobId[]" defaultValue=""><option value="">—</option>{o.openJobs.map((j) => <option key={j.id} value={j.id}>{j.jobNo} {j.name}</option>)}</select></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </ActionForm>
        </details>
      )}

      {open && (
        <>
          <h2>{t("open")}</h2>
          {open.length === 0 ? <p className="card muted">{t("noneOpen")}</p> : (
            <div className="table-wrap"><table>
              <thead><tr><th>{t("number")}</th><th>{t("partner")}</th><th>{t("kind")}</th><th>{t("total")}</th><th>{t("outstanding")}</th><th>{t("dueDate")}</th></tr></thead>
              <tbody>{open.map((i) => (
                <tr key={i.id}>
                  <td dir="ltr"><Link href={`/${locale}/finance/invoices/${i.id}`}>{i.no}</Link></td><td>{i.partner}</td><td>{i.kind === "sales" ? t("salesInvoice") : t("bill")}</td>
                  <td className="num">{m(i.total, i.currency)}</td><td className="num"><strong>{m(i.outstanding, i.currency)}</strong></td>
                  <td className={i.dueDate && i.dueDate < today ? "state-missing" : ""}>{i.dueDate ?? "—"}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          {o && open.length > 0 && (
            <details className="panel">
              <summary>{t("recordPayment")}</summary>
              <ActionForm command="payments.invoice" locale={locale} idempotencyKey={k()} submitLabel={f("save")} summary="Invoice payment">
                <div className="grid2">
                  <label>{t("invoice")}<select name="invoiceId" required>{open.map((i) => <option key={i.id} value={i.id}>{i.no} · {i.partner} · {m(i.outstanding, i.currency)}</option>)}</select></label>
                  <label>{f("paidFrom")}<select name="moneyAccountId" required>{o.moneyAccounts.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.currency})</option>)}</select></label>
                  <label>{f("amount")}<input name="amount" required inputMode="decimal" dir="ltr" /></label>
                  <label>{f("date")}<input type="date" name="paymentDate" required defaultValue={today} /></label>
                  <label>{f("method")}<select name="method" defaultValue="bank_transfer">{["cash", "bank_transfer", "cheque", "other"].map((x) => <option key={x} value={x}>{f(x)}</option>)}</select></label>
                </div>
              </ActionForm>
            </details>
          )}
        </>
      )}

      {reports && (
        <>
          <h2>{t("reports")}</h2>
          <form className="row" method="get">
            <label>{t("from")} <input type="date" name="from" defaultValue={from} /></label>
            <label>{t("to")} <input type="date" name="to" defaultValue={to} /></label>
            <button type="submit">{t("show")}</button>
          </form>
          <h3>{t("pl")}</h3>
          {reports.pl.length === 0 ? <p className="muted">—</p> : reports.pl.map((p) => (
            <div key={p.currency} className="table-wrap" style={{ marginBlockEnd: 8 }}><table>
              <thead><tr><th>{p.currency}</th><th className="num" /></tr></thead>
              <tbody>
                {p.income.map((l) => <tr key={l.code}><td>{l.code} · {l.name}</td><td className="num">{m(l.amount, p.currency)}</td></tr>)}
                <tr><td><strong>{t("totalIncome")}</strong></td><td className="num"><strong>{m(p.totalIncome, p.currency)}</strong></td></tr>
                {p.expenses.map((l) => <tr key={l.code}><td>{l.code} · {l.name}</td><td className="num">{m(l.amount, p.currency)}</td></tr>)}
                <tr><td><strong>{t("totalExpenses")}</strong></td><td className="num"><strong>{m(p.totalExpenses, p.currency)}</strong></td></tr>
                <tr><td><strong>{t("netProfit")}</strong></td><td className="num"><strong>{m(p.netProfit, p.currency)}</strong></td></tr>
              </tbody>
            </table></div>
          ))}
          <h3>{t("bs", { date: to })}</h3>
          {reports.bs.map((b) => (
            <div key={b.currency} className="table-wrap" style={{ marginBlockEnd: 8 }}><table>
              <thead><tr><th>{b.currency}</th><th className="num">{b.balanced ? "✓" : t("unbalanced")}</th></tr></thead>
              <tbody>
                {b.assets.map((l) => <tr key={l.code}><td>{l.code} · {l.name}</td><td className="num">{m(l.amount, b.currency)}</td></tr>)}
                <tr><td><strong>{t("totalAssets")}</strong></td><td className="num"><strong>{m(b.totalAssets, b.currency)}</strong></td></tr>
                {[...b.liabilities, ...b.equity].map((l) => <tr key={l.code}><td>{l.code} · {l.name}</td><td className="num">{m(l.amount, b.currency)}</td></tr>)}
                <tr><td>{t("retainedEarnings")}</td><td className="num">{m(b.retainedEarnings, b.currency)}</td></tr>
                <tr><td><strong>{t("totalLE")}</strong></td><td className="num"><strong>{m(b.totalLiabilitiesAndEquity, b.currency)}</strong></td></tr>
              </tbody>
            </table></div>
          ))}
        </>
      )}
    </Shell>
  );
}
