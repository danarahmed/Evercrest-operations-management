import { eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { ActionForm } from "@/components/ActionForm";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/Modal";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { formatMoney, intlLocale } from "@/lib/format";
import { can } from "@/server/authz";
import { exchangeView } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../../shell";

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
      <PageHeader title={t("title")} subtitle={t("intro")} actions={can(actor, "exchanges.create") && active.length > 1 && (
        <Modal label={t("new")} variant="primary" icon={<Icon name="exchange" size={16} />}>
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
        </Modal>
      )} />
      <Card flush title={t("history")} icon="exchange">
      {v.exchanges.length === 0 ? <EmptyState icon="exchange" title={t("none")} /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>{t("no")}</th><th>{f("date")}</th><th className="num">{t("given")}</th><th className="num">{t("received")}</th><th className="num">{t("rate")}</th><th /></tr></thead>
          <tbody>{v.exchanges.map((x) => (
            <tr key={x.id} className={x.status === "reversed" ? "muted" : ""}>
              <td dir="ltr">{x.exchangeNo}</td><td>{x.exchangeDate}</td>
              <td className="num">{m(x.fromAmount, x.fromCurrency)}</td><td className="num">{m(x.toAmount, x.toCurrency)}</td>
              <td className="num" dir="ltr">1 {x.fromCurrency} = {new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 6 }).format(Number(x.rate))} {x.toCurrency}</td>
              <td>{x.status === "reversed" ? <Badge>{t("reversed")}</Badge> : can(actor, "payments.reverse") && (
                <Modal label={t("reverse")} small variant="ghost" size="sm" title={`${t("reverse")} ${x.exchangeNo}`}>
                  <ActionForm command="exchanges.reverse" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("reverse")}>
                    <input type="hidden" name="exchangeId" value={x.id} />
                    <div className="grid2">
                      <label>{t("date")}<input type="date" name="reversalDate" required defaultValue={today} /></label>
                      <label>{t("reason")}<input name="reason" required /></label>
                    </div>
                  </ActionForm>
                </Modal>
              )}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      </Card>
    </Shell>
  );
}
