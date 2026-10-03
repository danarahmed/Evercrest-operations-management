import { eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { ActionForm } from "@/components/ActionForm";
import { dec } from "@/domain/money";
import { formatMoney } from "@/lib/format";
import { can } from "@/server/authz";
import { accountsOverview } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../../shell";
import { FinanceNav } from "../nav";

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
  const monthName = (mo: number) => new Intl.DateTimeFormat(locale, { month: "long" }).format(new Date(Date.UTC(year, mo - 1, 1)));
  const currencies = [...new Set(o.trialBalance.map((r) => r.currency))].sort();

  return (
    <Shell wide permissions={actor.permissions} locale={locale} userName={user.displayName} path="/finance/accounts">
      <h1>{t("title")}</h1>
      <FinanceNav locale={locale} current="accounts" />

      <h2>{t("money")}</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>{t("moneyAccount")}</th><th>{t("kind")}</th><th>{t("currency")}</th><th className="num">{t("balance")}</th></tr></thead>
        <tbody>{o.money.map((x) => (
          <tr key={x.id} className={x.active ? "" : "muted"}>
            <td>{x.name}</td><td>{t(`kind_${x.kind}`)}</td><td>{x.currency}</td>
            <td className={`num ${dec(x.balance).lt(0) ? "state-missing" : ""}`}><strong>{m(x.balance, x.currency)}</strong></td>
          </tr>
        ))}</tbody>
      </table></div>

      {can(actor, "payments.create") && active.length > 1 && (
        <details className="panel">
          <summary>{t("transfer")}</summary>
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
        </details>
      )}

      {can(actor, "payments.create") && active.length > 0 && (
        <details className="panel">
          <summary>{t("other")}</summary>
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
        </details>
      )}

      <h2>{t("trialBalance")}</h2>
      <form className="row no-print" method="get">
        <label>{t("asOf")} <input type="date" name="asOf" defaultValue={asOf} /></label>
        <input type="hidden" name="year" value={year} />
        <button type="submit">{t("show")}</button>
      </form>
      <p className="muted">{t("tbHelp")}</p>
      {currencies.map((cur) => {
        const rows = o.trialBalance.filter((r) => r.currency === cur);
        const td = rows.reduce((s, r) => s.plus(dec(r.debit)), dec("0"));
        const tc = rows.reduce((s, r) => s.plus(dec(r.credit)), dec("0"));
        return (
          <div key={cur} className="table-wrap" style={{ marginBlockEnd: 12 }}><table>
            <thead><tr><th>{cur}</th><th>{t("type")}</th><th className="num">{t("debit")}</th><th className="num">{t("credit")}</th><th className="num">{t("balance")}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.accountId}><td>{r.code} · {r.name}</td><td>{t(`type_${r.type}`)}</td><td className="num">{m(r.debit, cur)}</td><td className="num">{m(r.credit, cur)}</td><td className="num">{m(r.balance, cur)}</td></tr>
              ))}
              <tr className="subtotal"><td colSpan={2}><strong>{t("total")}</strong> {td.eq(tc) ? "✓" : <span className="state-missing">{t("unbalanced")}</span>}</td><td className="num"><strong>{m(td.toString(), cur)}</strong></td><td className="num"><strong>{m(tc.toString(), cur)}</strong></td><td /></tr>
            </tbody>
          </table></div>
        );
      })}

      <h2>{t("periods", { year })}</h2>
      <p className="muted">{t("periodsHelp")}</p>
      <form className="row no-print" method="get">
        <input type="hidden" name="asOf" value={asOf} />
        <label>{t("year")} <input type="number" name="year" defaultValue={year} min={2020} max={2100} style={{ width: "6em" }} /></label>
        <button type="submit">{t("show")}</button>
      </form>
      <div className="table-wrap"><table>
        <tbody>{o.periods.map((p) => (
          <tr key={p.month}>
            <td>{monthName(p.month)}</td>
            <td><span className={`badge ${p.status === "locked" ? "state-missing" : "state-verified"}`}>{t(`period_${p.status}`)}</span></td>
            <td>{can(actor, "periods.manage") && (
              <ActionForm command="ledger.set_period_status" locale={locale} idempotencyKey={k()} submitLabel={p.status === "locked" ? t("unlock") : t("lock")}>
                <input type="hidden" name="year" value={year} />
                <input type="hidden" name="month" value={p.month} />
                <input type="hidden" name="status" value={p.status === "locked" ? "open" : "locked"} />
                <input name="reason" required placeholder={t("reason")} />
              </ActionForm>
            )}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </Shell>
  );
}
