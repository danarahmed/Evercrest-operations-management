import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Fragment } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { PrintButton } from "@/components/PrintButton";
import { dec } from "@/domain/money";
import { formatMoney } from "@/lib/format";
import { partnerAccount } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../../../shell";
import { FinanceNav } from "../../nav";

export const dynamic = "force-dynamic";

/** A partner's account history with a running balance per currency (printable as an account statement). */
export default async function PartnerAccountPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const t = await getTranslations({ locale, namespace: "PartnerAccounts" });
  const s = await getTranslations({ locale, namespace: "Setup" });
  const v = await partnerAccount(db, actor, id);
  if (!v) notFound();
  const m = (a: string, c: string) => (a === "0" ? "" : formatMoney(a, c, locale));
  const bal = (a: string, c: string) => <span className={dec(a).lt(0) ? "state-missing" : ""}>{formatMoney(dec(a).abs().toString(), c, locale)} {dec(a).isZero() ? "" : dec(a).gt(0) ? t("owesUs") : t("weOwe")}</span>;
  return (
    <Shell wide permissions={actor.permissions} locale={locale} userName={user.displayName} path={`/finance/partners/${id}`}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>{v.partner.name}</h1>
        <PrintButton label={t("print")} />
      </div>
      <FinanceNav locale={locale} current="partners" />
      <dl className="kv card">
        <dt>{t("roles")}</dt><dd>{v.roles.map((x) => s(`role_${x}`)).join(", ")}</dd>
        {v.partner.phone && <><dt>{s("phone")}</dt><dd dir="ltr">{v.partner.phone}</dd></>}
        {Object.entries(v.balances).map(([c, a]) => <Fragment key={c}><dt>{t("balance")} {c}</dt><dd><strong>{bal(a, c)}</strong></dd></Fragment>)}
      </dl>
      {v.lines.length === 0 ? <p className="card muted">{t("noHistory")}</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>{t("date")}</th><th>{t("document")}</th><th>{t("detail")}</th><th>{t("account")}</th><th>{t("currency")}</th><th className="num">{t("debit")}</th><th className="num">{t("credit")}</th><th className="num">{t("balance")}</th></tr></thead>
          <tbody>{v.lines.map((l) => (
            <tr key={l.id}>
              <td>{l.date}</td><td dir="ltr">{l.source ?? `#${l.entryNo}`}</td>
              <td className="wrap" dir="auto">{l.description}{l.jobNo ? ` · ${l.jobNo}` : ""}</td>
              <td>{l.account}</td><td>{l.currency}</td>
              <td className="num">{m(l.debit, l.currency)}</td><td className="num">{m(l.credit, l.currency)}</td>
              <td className="num">{bal(l.balance, l.currency)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Shell>
  );
}
