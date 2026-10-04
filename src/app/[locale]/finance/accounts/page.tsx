import { eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { ActionForm } from "@/components/ActionForm";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/Modal";
import { Badge, Card, Cur, PageHeader, Stat } from "@/components/ui";
import { ExportButton } from "@/components/ExportButton";

import { dec } from "@/domain/money";
import { formatMoney, intlLocale } from "@/lib/format";
import { can } from "@/server/authz";
import { accountsOverview } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../../shell";

export const dynamic = "force-dynamic";

/** Cash and bank balances, money movements between own accounts, other receipts/payments, trial balance, month locks. */
export default async function AccountsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ asOf?: string; year?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const t = await getTranslations({ locale, namespace: "Accounts" });
  const f = await getTranslations({ locale, namespace: "Forms" });
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const asOf = sp.asOf ?? today;
  const year = Number(sp.year ?? today.slice(0, 4));
  const o = await accountsOverview(db, actor, asOf, year);
  const m = (a: string, c: string) => formatMoney(a, c, locale);
  const k = () => crypto.randomUUID();
  const active = o.money.filter((x) => x.active);
  const monthName = (mo: number) => new Intl.DateTimeFormat(intlLocale(locale), { month: "long" }).format(new Date(Date.UTC(year, mo - 1, 1)));
  const currencies = [...new Set(o.trialBalance.map((r) => r.currency))].sort();

  return (
    <Shell wide permissions={actor.permissions} locale={locale} userName={user.displayName} path="/finance/accounts">
      <PageHeader title={t("title")} subtitle={t("subtitle")} actions={<>
      <ExportButton label={f("export")} filename="evercrest-trial-balance" />
      {can(actor, "payments.create") && active.length > 1 && (
        <Modal label={t("transfer")} icon={<Icon name="exchange" size={16} />}>
          <p className="muted">{t("transferHelp")}</p>
          <ActionForm command="transfers.create" locale={locale} idempotencyKey={k()} submitLabel={f("save")}>
            <div className="grid2">
              <label>{t("from")}<select name="fromMoneyAccountId" required>{active.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.currency})</option>)}</select></label>
              <label>{t("to")}<select name="toMoneyAccountId" required>{active.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.currency})</option>)}</select></label>
              <label>{f("amount")}<input name="amount" required inputMode="decimal" dir="ltr" /></label>
              <label>{f("date")}<input type="date" name="transferDate" required defaultValue={today} /></label>
              <label>{f("reference")}<input name="reference" dir="ltr" /></label>
            </div>
          </ActionForm>
        </Modal>
      )}

      {can(actor, "payments.create") && active.length > 0 && (
        <Modal label={t("other")} variant="primary" icon={<Icon name="plus" size={16} />}>
          <p className="muted">{t("otherHelp")}</p>
          <ActionForm command="payments.record" locale={locale} idempotencyKey={k()} submitLabel={f("save")} summary="Other money movement">
            <input type="hidden" name="purpose" value="other" />
            <div className="grid2">
              <label>{t("direction")}<select name="direction" required><option value="in">{t("moneyIn")}</option><option value="out">{t("moneyOut")}</option></select></label>
              <label>{t("moneyAccount")}<select name="moneyAccountId" required>{active.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.currency})</option>)}</select></label>
              <label>{t("account")}<select name="counterAccountId" required>{o.accounts.filter((a) => !o.money.some((x) => x.ledgerAccountId === a.id)).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></label>
              <label>{f("amount")}<input name="amount" required inputMode="decimal" dir="ltr" /></label>
              <label>{f("date")}<input type="date" name="paymentDate" required defaultValue={today} /></label>
              <label>{f("method")}<select name="method" defaultValue="cash">{["cash", "bank_transfer", "cheque", "other"].map((x) => <option key={x} value={x}>{f(x)}</option>)}</select></label>
              <label>{f("description")}<input name="notes" required /></label>
              <label>{f("reference")}<input name="reference" dir="ltr" /></label>
            </div>
          </ActionForm>
        </Modal>
      )}

      </>} />

      <h2 style={{ marginBlockStart: 0 }}>{t("money")}</h2>
      <div className="stats">
        {o.money.map((x) => (
          <Stat key={x.id} label={<>{x.name} · {t(`kind_${x.kind}`)}</>} value={<span className={dec(x.balance).lt(0) ? "neg" : ""}>{m(x.balance, x.currency)}</span>} icon={x.kind === "bank" ? "bank" : "wallet"} tone={x.active ? (dec(x.balance).lt(0) ? "danger" : "success") : undefined} />
        ))}
      </div>

      <div className="row between" style={{ marginBlock: "24px 10px" }}>
        <h2 style={{ margin: 0 }}>{t("trialBalance")}</h2>
        <form className="filters no-print" method="get" style={{ margin: 0 }}>
          <label>{t("asOf")}<input type="date" name="asOf" defaultValue={asOf} /></label>
          <input type="hidden" name="year" value={year} />
          <button type="submit">{t("show")}</button>
        </form>
      </div>
      <p className="muted">{t("tbHelp")}</p>
      {currencies.map((cur) => {
        const rows = o.trialBalance.filter((r) => r.currency === cur);
        const td = rows.reduce((s, r) => s.plus(dec(r.debit)), dec("0"));
        const tc = rows.reduce((s, r) => s.plus(dec(r.credit)), dec("0"));
        return (
          <Card key={cur} flush title={<>{t("trialBalance")} <Cur code={cur} /></>} icon="book" subtitle={td.eq(tc) ? t("balancedOk") : undefined}><div className="table-wrap"><table>
            <thead><tr><th>{t("accountCol")}</th><th>{t("type")}</th><th className="num">{t("debit")}</th><th className="num">{t("credit")}</th><th className="num">{t("balance")}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.accountId}><td><span className="font-mono text-slate-400">{r.code}</span> {r.name}</td><td>{t(`type_${r.type}`)}</td><td className="num">{m(r.debit, cur)}</td><td className="num">{m(r.credit, cur)}</td><td className="num">{m(r.balance, cur)}</td></tr>
              ))}
              <tr className="subtotal"><td colSpan={2}><strong>{t("total")}</strong> {td.eq(tc) ? "✓" : <span className="state-missing">{t("unbalanced")}</span>}</td><td className="num"><strong>{m(td.toString(), cur)}</strong></td><td className="num"><strong>{m(tc.toString(), cur)}</strong></td><td /></tr>
            </tbody>
          </table></div></Card>
        );
      })}


      <Card title={t("periods", { year })} subtitle={t("periodsHelp")} icon="calendar" actions={
        <form className="row no-print" method="get">
          <input type="hidden" name="asOf" value={asOf} />
          <input type="number" name="year" defaultValue={year} min={2020} max={2100} style={{ width: "6.5em" }} aria-label={t("year")} />
          <button type="submit" className="sm">{t("show")}</button>
        </form>
      }>
      <div className="months">
        {o.periods.map((p) => (
          <div key={p.month} className={`month${p.status === "locked" ? " locked" : ""}`}>
            <div className="month-name"><Icon name={p.status === "locked" ? "lock" : "calendar"} size={15} />{monthName(p.month)}</div>
            <Badge tone={p.status === "locked" ? "danger" : "success"}>{t(`period_${p.status}`)}</Badge>
            {can(actor, "periods.manage") && (
              <Modal small size="sm" variant={p.status === "locked" ? "ghost" : "secondary"} label={p.status === "locked" ? t("unlock") : t("lock")} title={`${p.status === "locked" ? t("unlock") : t("lock")} · ${monthName(p.month)} ${year}`}>
                <ActionForm command="ledger.set_period_status" locale={locale} idempotencyKey={k()} submitLabel={p.status === "locked" ? t("unlock") : t("lock")} variant={p.status === "locked" ? "secondary" : "primary"}>
                  <input type="hidden" name="year" value={year} />
                  <input type="hidden" name="month" value={p.month} />
                  <input type="hidden" name="status" value={p.status === "locked" ? "open" : "locked"} />
                  <label>{t("reason")}<input name="reason" required /></label>
                </ActionForm>
              </Modal>
            )}
          </div>
        ))}
      </div>
      </Card>
    </Shell>
  );
}
