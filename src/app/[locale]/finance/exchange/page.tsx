import { eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { ActionForm } from "@/components/ActionForm";
import { formatMoney } from "@/lib/format";
import { can } from "@/server/authz";
import { exchangeView } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../../shell";
import { FinanceNav } from "../nav";

export const dynamic = "force-dynamic";

/** Selling one currency for the other (USD ↔ IQD) at the rate actually obtained. Never recomputed. */
export default async function ExchangePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const t = await getTranslations({ locale, namespace: "Exchange" });
  const f = await getTranslations({ locale, namespace: "Forms" });
  const v = await exchangeView(db, actor);
  const today = new Date().toISOString().slice(0, 10);
  const active = v.money.filter((x) => x.active);
  const m = (a: string, c: string) => formatMoney(a, c, locale);

  return (
    <Shell permissions={actor.permissions} locale={locale} userName={user.displayName} path="/finance/exchange">
      <h1>{t("title")}</h1>
      <FinanceNav locale={locale} current="exchange" />
      <p className="muted">{t("intro")}</p>
      {can(actor, "exchanges.create") && active.length > 1 && (
        <details className="panel" open>
          <summary>{t("new")}</summary>
          <ActionForm command="exchanges.create" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={f("save")}>
            <div className="grid2">
              <label>{t("from")}<select name="fromMoneyAccountId" required>{active.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.currency}) · {m(x.balance, x.currency)}</option>)}</select></label>
              <label>{t("amountGiven")}<input name="fromAmount" required inputMode="decimal" dir="ltr" /></label>
              <label>{t("to")}<select name="toMoneyAccountId" required defaultValue={active.find((x) => x.currency !== active[0].currency)?.id}>{active.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.currency})</option>)}</select></label>
              <label>{t("amountReceived")}<input name="toAmount" required inputMode="decimal" dir="ltr" /></label>
              <label>{f("date")}<input type="date" name="exchangeDate" required defaultValue={today} /></label>
              <label>{f("reference")}<input name="reference" dir="ltr" /></label>
            </div>
          </ActionForm>
        </details>
      )}
      {v.exchanges.length === 0 ? <p className="card muted">{t("none")}</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>{t("no")}</th><th>{f("date")}</th><th className="num">{t("given")}</th><th className="num">{t("received")}</th><th className="num">{t("rate")}</th><th /></tr></thead>
          <tbody>{v.exchanges.map((x) => (
            <tr key={x.id} className={x.status === "reversed" ? "muted" : ""}>
              <td dir="ltr">{x.exchangeNo}</td><td>{x.exchangeDate}</td>
              <td className="num">{m(x.fromAmount, x.fromCurrency)}</td><td className="num">{m(x.toAmount, x.toCurrency)}</td>
              <td className="num" dir="ltr">1 {x.fromCurrency} = {new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(Number(x.rate))} {x.toCurrency}</td>
              <td>{x.status === "reversed" ? <span className="badge">{t("reversed")}</span> : can(actor, "payments.reverse") && (
                <details className="no-print">
                  <summary>{t("reverse")}</summary>
                  <ActionForm command="exchanges.reverse" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("reverse")}>
                    <input type="hidden" name="exchangeId" value={x.id} />
                    <input type="date" name="reversalDate" required defaultValue={today} />
                    <input name="reason" required placeholder={t("reason")} />
                  </ActionForm>
                </details>
              )}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Shell>
  );
}
