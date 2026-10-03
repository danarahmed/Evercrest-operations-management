import { eq } from "drizzle-orm";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Fragment } from "react";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { ActionForm } from "@/components/ActionForm";
import { PrintButton } from "@/components/PrintButton";
import { dec, toStr } from "@/domain/money";
import { formatMoney, formatQty } from "@/lib/format";
import { can } from "@/server/authz";
import { statementView } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../../shell";

export const dynamic = "force-dynamic";

export default async function StatementPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const t = await getTranslations({ locale, namespace: "Statements" });
  const f = await getTranslations({ locale, namespace: "Forms" });
  const s = await getTranslations({ locale, namespace: "Settle" });
  const v = await statementView(db, actor, id);
  const st = v.statement;
  const cur = st.currency;
  const today = new Date().toISOString().slice(0, 10);
  const m = (a: string) => formatMoney(a, cur, locale);
  const q = (a: string | null, unit: string) => (a === null ? "—" : formatQty(a, unit, locale));
  const amountOf = (lines: { code: string; amount: string }[], code: string) => lines.find((l) => l.code === code)?.amount ?? "0";
  const isDriver = st.party === "driver";

  // Group by payee, so each driver (or the transporter) gets a subtotal.
  const groups = new Map<string, typeof v.lines>();
  for (const l of v.lines) groups.set(l.payeeId, [...(groups.get(l.payeeId) ?? []), l]);
  const payeeName = (pid: string) => v.payees.find((p) => p.partnerId === pid)?.name ?? (isDriver ? groups.get(pid)![0].driver : groups.get(pid)![0].transporter) ?? "";
  const cols = isDriver ? 12 : 7;
  const unpaid = v.payees.filter((p) => !p.payment && dec(p.total).gt(0));
  // Payees who owe the company on this statement and have not cleared it (not brought forward, repaid or written off).
  const debtors = v.payees.filter((p) => p.debt && dec(p.debt.open).gt(0));

  return (
    <Shell wide permissions={actor.permissions} locale={locale} userName={user.displayName} path={`/statements/${id}`}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 dir="ltr">{st.statementNo}</h1>
        <PrintButton label={t("print")} />
      </div>
      <dl className="kv card">
        <dt>{t("party")}</dt><dd>{t(`party_${st.party}`)}</dd>
        <dt>{t("date")}</dt><dd>{st.statementDate}</dd>
        <dt>{t("status")}</dt><dd><span className={`badge ${st.status === "paid" ? "state-verified" : ""}`}>{t(`status_${st.status === "paid" && !dec(st.total).gt(0) ? "nothing" : st.status}`)}</span></dd>
        <dt>{t("total")}</dt><dd className="num"><strong>{m(st.total)}</strong></dd>
        {st.notes && <><dt>{t("notes")}</dt><dd>{st.notes}</dd></>}
      </dl>

      <div className="table-wrap"><table className="statement">
        <thead>
          <tr>
            <th>{t("trip")} / {t("job")}</th><th>{t("driver")} / {t("truck")}</th>
            {isDriver ? (
              <><th className="num">{t("loaded")}</th><th className="num">{t("discharged")}</th><th className="num">{t("actual")}</th><th>{t("shortage")}</th>
                <th className="num">{t("pay")}</th><th className="num">{t("demurrage")}</th><th className="num">{t("fine")}</th></>
            ) : (
              <><th className="num">{t("actual")}</th><th className="num">{t("fee")}</th></>
            )}
            <th className="num">{t("advances")}</th><th className="num">{t("rounding")}</th><th className="num">{t("net")}</th>
          </tr>
        </thead>
        <tbody>
          {[...groups.entries()].map(([pid, lines]) => (
            <Fragment key={pid}>
              {!isDriver && <tr><th colSpan={cols}>{payeeName(pid)}</th></tr>}
              {lines.map((l) => {
                const qq = l.calc.quantities;
                return (
                  <tr key={l.tripNo}>
                    <td><span dir="ltr">{l.tripNo}</span><br /><small className="muted" dir="ltr">{l.jobNo}</small></td><td>{l.driver}<br /><small className="muted" dir="ltr">{l.plate}</small></td>
                    {isDriver ? (
                      <>
                        <td className="num">{q(qq.loaded, qq.unit)}</td><td className="num">{q(qq.discharged, qq.unit)}</td><td className="num">{q(qq.actual, qq.unit)}</td>
                        <td>{qq.loss === "0" ? "—" : `${q(qq.loss, "").trim()} / ${q(l.calc.allowance, "").trim()} / ${q(l.calc.chargeableShortage, qq.unit)}`}</td>
                        <td className="num">{m(amountOf(l.side.lines, "driver_pay"))}</td>
                        <td className="num">{l.calc.demurrageDays ? `${m(amountOf(l.side.lines, "demurrage"))} (${l.calc.demurrageDays})` : "—"}</td>
                        <td className="num">{amountOf(l.side.lines, "shortage_fine") === "0" ? "—" : m(amountOf(l.side.lines, "shortage_fine"))}</td>
                      </>
                    ) : (
                      <><td className="num">{q(qq.actual, qq.unit)}</td><td className="num">{m(amountOf(l.side.lines, "transporter_fee"))}</td></>
                    )}
                    <td className="num">{l.side.advancesDeducted === "0" ? "—" : m(`-${l.side.advancesDeducted}`)}</td>
                    <td className="num">{l.side.rounding === "0" ? "—" : m(toStr(dec(l.side.rounding).neg()))}</td>
                    <td className="num"><strong>{m(l.amount)}</strong></td>
                  </tr>
                );
              })}
              {v.broughtForward.filter((b) => b.payeeId === pid).map((b) => (
                <tr key={b.fromId}>
                  <td colSpan={cols - 1}>{t("broughtForward", { statement: b.fromNo })}</td>
                  <td className="num"><strong>{m(b.amount)}</strong></td>
                </tr>
              ))}
              {(lines.length > 1 || !isDriver || v.broughtForward.some((b) => b.payeeId === pid)) && (
                <tr className="subtotal">
                  <td colSpan={cols - 1}>{t("subtotal", { name: payeeName(pid) })}</td>
                  <td className="num"><strong>{m(toStr([...lines, ...v.broughtForward.filter((b) => b.payeeId === pid)].reduce((sum, l) => sum.plus(dec(l.amount)), dec("0"))))}</strong></td>
                </tr>
              )}
            </Fragment>
          ))}
          <tr className="subtotal"><td colSpan={cols - 1}><strong>{t("grandTotal")}</strong></td><td className="num"><strong>{m(st.total)}</strong></td></tr>
        </tbody>
      </table></div>
      {v.lines.some((l) => Object.keys(l.side.advancesOtherCurrency).length) && (
        <ul className="muted">{v.lines.flatMap((l) => Object.entries(l.side.advancesOtherCurrency).map(([c, a]) => <li key={`${l.tripNo}${c}`} dir="auto">{l.tripNo}: {s("otherCurrencyAdvance", { amount: formatMoney(a, c, locale) })}</li>))}</ul>
      )}

      <h2>{t("payees")}</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>{t("payee")}</th><th className="num">{t("owed")}</th><th>{t("status")}</th></tr></thead>
        <tbody>{v.payees.map((p) => (
          <tr key={p.partnerId}>
            <td>{p.name}</td><td className="num">{m(p.total)}</td>
            <td>
              {p.payment ? <span className="badge state-verified" dir="auto">{t("paid", { no: p.payment.no, date: p.payment.date })}</span>
                : dec(p.total).gt(0) ? t("unpaid")
                : !p.debt ? "—"
                : (
                  <span className="stack">
                    <span className={dec(p.debt.open).gt(0) ? "state-missing" : ""}>{dec(p.debt.open).gt(0) ? t("owesOpen", { amount: m(p.debt.open) }) : t("debtCleared")}</span>
                    {p.debt.carriedTo && <small>{t("carriedTo", { statement: p.debt.carriedTo.no })} <Link href={`/${locale}/statements/${p.debt.carriedTo.id}`} className="no-print">→</Link></small>}
                    {p.repayments.map((r) => <small key={r.id} dir="auto">{t("repaid", { amount: m(r.amount), no: r.no, date: r.date })}</small>)}
                    {dec(p.debt.writtenOff).gt(0) && <small>{t("writtenOff", { amount: m(p.debt.writtenOff) })}</small>}
                  </span>
                )}
            </td>
          </tr>
        ))}</tbody>
      </table></div>

      {st.status === "open" && unpaid.length > 0 && can(actor, "payments.create") && (
        <details className="panel no-print">
          <summary>{t("payTitle")}</summary>
          <ActionForm command="statements.pay" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("paySubmit")} summary={`${st.statementNo} ${m(st.total)}`}>
            <input type="hidden" name="statementId" value={st.id} />
            {unpaid.length > 1 && (
              <fieldset className="row"><legend>{t("payOnly")}</legend>
                {unpaid.map((p) => <label key={p.partnerId} className="row"><input type="checkbox" name="partnerIds[]" value={p.partnerId} />{p.name} ({m(p.total)})</label>)}
              </fieldset>
            )}
            <div className="grid2">
              <label>{t("payFrom")}<select name="moneyAccountId" required>{v.payFrom.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.currency})</option>)}</select></label>
              <label>{f("date")}<input type="date" name="paymentDate" required defaultValue={today} /></label>
              <label>{f("method")}<select name="method" defaultValue="cash">{["cash", "bank_transfer", "cheque", "other"].map((x) => <option key={x} value={x}>{f(x)}</option>)}</select></label>
            </div>
          </ActionForm>
        </details>
      )}
      {debtors.length > 0 && can(actor, "payments.create") && (
        <details className="panel no-print">
          <summary>{t("collectTitle")}</summary>
          <p className="muted">{t("collectHelp")}</p>
          <ActionForm command="statements.collect_debt" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("collectSubmit")}>
            <input type="hidden" name="statementId" value={st.id} />
            <div className="grid2">
              <label>{t("payee")}<select name="partnerId" required>{debtors.map((p) => <option key={p.partnerId} value={p.partnerId}>{p.name} ({m(p.debt!.open)})</option>)}</select></label>
              <label>{f("amount")}<input name="amount" inputMode="decimal" dir="ltr" placeholder={t("allOpen")} /></label>
              <label>{t("receivedIn")}<select name="moneyAccountId" required>{v.payFrom.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.currency})</option>)}</select></label>
              <label>{f("date")}<input type="date" name="paymentDate" required defaultValue={today} /></label>
              <label>{f("method")}<select name="method" defaultValue="cash">{["cash", "bank_transfer", "cheque", "other"].map((x) => <option key={x} value={x}>{f(x)}</option>)}</select></label>
            </div>
          </ActionForm>
        </details>
      )}
      {debtors.length > 0 && can(actor, "settlements.reverse") && (
        <details className="panel no-print">
          <summary>{t("writeOffTitle")}</summary>
          <p className="muted">{t("writeOffHelp")}</p>
          <ActionForm command="statements.write_off_debt" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("writeOffSubmit")} summary={`${st.statementNo} write-off`}>
            <input type="hidden" name="statementId" value={st.id} />
            <div className="grid2">
              <label>{t("payee")}<select name="partnerId" required>{debtors.map((p) => <option key={p.partnerId} value={p.partnerId}>{p.name} ({m(p.debt!.open)})</option>)}</select></label>
              <label>{f("date")}<input type="date" name="writeOffDate" required defaultValue={today} /></label>
              <label>{t("reason")}<input name="reason" required /></label>
            </div>
          </ActionForm>
        </details>
      )}
      {st.status !== "cancelled" && !v.payees.some((p) => p.payment || p.repayments.length) && can(actor, "settlements.reverse") && (
        <details className="panel no-print">
          <summary>{t("cancelTitle")}</summary>
          <ActionForm command="statements.cancel" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("cancelSubmit")}>
            <input type="hidden" name="statementId" value={st.id} />
            <label>{t("reason")}<input name="reason" required /></label>
          </ActionForm>
        </details>
      )}
      <p className="no-print"><Link href={`/${locale}/statements`}>← {t("title")}</Link></p>
    </Shell>
  );
}
