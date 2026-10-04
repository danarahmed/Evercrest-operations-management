import { eq } from "drizzle-orm";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { ActionForm } from "@/components/ActionForm";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/Modal";
import { Amounts, Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { dec, toStr } from "@/domain/money";
import { formatMoney } from "@/lib/format";
import { can } from "@/server/authz";
import { financeOptions, openInvoices } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../shell";

export const dynamic = "force-dynamic";
const LINES = 3;

/** Invoices to customers and bills from suppliers that are not fully paid, and the forms to create and settle them. */
export default async function Finance({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const t = await getTranslations({ locale, namespace: "Finance" });
  const f = await getTranslations({ locale, namespace: "Forms" });
  const today = new Date().toISOString().slice(0, 10);
  const canCreate = can(actor, "invoices.create");
  const canView = can(actor, "reports.financial.view");
  const [o, open] = await Promise.all([canCreate ? financeOptions(db, actor) : null, canView ? openInvoices(db, actor) : null]);
  const k = () => crypto.randomUUID();
  const m = (amount: string, cur: string) => formatMoney(amount, cur, locale);
  const sales = (open ?? []).filter((i) => i.kind === "sales");
  const bills = (open ?? []).filter((i) => i.kind === "bill");
  const total = (rows: typeof sales) => {
    const r: Record<string, string> = {};
    for (const i of rows) r[i.currency] = toStr(dec(r[i.currency] ?? "0").plus(dec(i.outstanding)));
    return r;
  };
  const overdue = (open ?? []).filter((i) => i.dueDate && i.dueDate < today);

  const list = (rows: typeof sales, emptyText: string) =>
    rows.length === 0 ? <EmptyState icon="checkCircle" title={emptyText} /> : (
      <div className="table-wrap"><table>
        <thead><tr><th>{t("number")}</th><th>{t("partner")}</th><th>{t("dueDate")}</th><th className="num">{t("total")}</th><th className="num">{t("outstanding")}</th></tr></thead>
        <tbody>{rows.map((i) => (
          <tr key={i.id}>
            <td className="ltr"><Link href={`/${locale}/finance/invoices/${i.id}`} className="cell-title">{i.no}</Link></td>
            <td>{i.partner}</td>
            <td>{i.dueDate ? (i.dueDate < today ? <Badge tone="danger">{i.dueDate}</Badge> : i.dueDate) : <span className="muted">—</span>}</td>
            <td className="num">{m(i.total, i.currency)}</td>
            <td className="num"><strong>{m(i.outstanding, i.currency)}</strong></td>
          </tr>
        ))}</tbody>
      </table></div>
    );

  const actions = o && (
    <>
      {open && open.length > 0 && (
        <Modal label={t("recordPayment")} icon={<Icon name="wallet" size={16} />}>
          <ActionForm command="payments.invoice" locale={locale} idempotencyKey={k()} submitLabel={f("save")} summary="Invoice payment">
            <label>{t("invoice")}<select name="invoiceId" required>{open.map((i) => <option key={i.id} value={i.id}>{i.no} · {i.partner} · {i.kind === "sales" ? t("toReceive") : t("toPay")} {m(i.outstanding, i.currency)}</option>)}</select></label>
            <div className="grid2">
              <label>{f("paidFrom")}<select name="moneyAccountId" required>{o.moneyAccounts.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.currency})</option>)}</select></label>
              <label>{f("amount")}<input name="amount" required inputMode="decimal" dir="ltr" /></label>
              <label>{f("date")}<input type="date" name="paymentDate" required defaultValue={today} /></label>
              <label>{f("method")}<select name="method" defaultValue="bank_transfer">{["cash", "bank_transfer", "cheque", "other"].map((x) => <option key={x} value={x}>{f(x)}</option>)}</select></label>
            </div>
          </ActionForm>
        </Modal>
      )}
      <Modal label={t("newInvoice")} icon={<Icon name="plus" size={16} />} variant="primary" size="lg">
        <ActionForm command="invoices.create" locale={locale} idempotencyKey={k()} submitLabel={f("save")}>
          <div className="grid2">
            <label>{t("kind")}<select name="kind" required><option value="sales">{t("salesInvoice")}</option><option value="bill">{t("bill")}</option></select></label>
            <label>{t("billFrom")} <span className="hint">{t("billFromHint")}</span>
              <select name="billFrom" defaultValue=""><option value="">—</option><option value="supplier">{t("supplier")}</option><option value="contractor">{t("contractor")}</option><option value="transporter">{t("transporter")}</option><option value="driver">{t("driver")}</option></select>
            </label>
            <label>{t("partner")}<select name="partnerId" required>{o.partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label>{t("currency")}<select name="currency" required><option value="IQD">IQD</option><option value="USD">USD</option></select></label>
            <label>{f("date")}<input type="date" name="invoiceDate" required defaultValue={today} /></label>
            <label>{t("dueDate")}<input type="date" name="dueDate" /></label>
            <label>{t("externalRef")}<input name="externalRef" dir="ltr" /></label>
          </div>
          <div className="table-wrap" style={{ marginBlockEnd: 0 }}><table className="dense">
            <thead><tr><th>{f("description")}</th><th>{f("quantity")}</th><th>{t("unitPrice")}</th><th>{t("account")}</th><th>{t("job")}</th></tr></thead>
            <tbody>
              {Array.from({ length: LINES }, (_, i) => (
                <tr key={i}>
                  <td><input name="l_description[]" required={i === 0} /></td>
                  <td><input name="l_quantity[]" inputMode="decimal" dir="ltr" style={{ width: 80 }} required={i === 0} /></td>
                  <td><input name="l_unitPrice[]" inputMode="decimal" dir="ltr" style={{ width: 110 }} required={i === 0} /></td>
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
      </Modal>
    </>
  );

  return (
    <Shell permissions={actor.permissions} locale={locale} userName={user.displayName} path="/finance">
      <PageHeader title={t("title")} subtitle={t("subtitle")} actions={actions} />
      {open && (
        <>
          <div className="stats">
            <Stat label={t("toReceiveTotal")} value={<Amounts values={total(sales)} format={m} />} icon="trendingUp" tone="success" hint={t("invoicesCount", { count: sales.length })} />
            <Stat label={t("toPayTotal")} value={<Amounts values={total(bills)} format={m} />} icon="wallet" tone="warning" hint={t("invoicesCount", { count: bills.length })} />
            <Stat label={t("overdue")} value={overdue.length} icon="alert" tone="danger" />
          </div>
          <div className="grid cols-2">
            <Card flush title={t("receivables")} subtitle={t("receivablesHelp")} icon="trendingUp">{list(sales, t("noneToReceive"))}</Card>
            <Card flush title={t("payables")} subtitle={t("payablesHelp")} icon="wallet">{list(bills, t("noneToPay"))}</Card>
          </div>
        </>
      )}
    </Shell>
  );
}
