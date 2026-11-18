import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { PrintButton } from "@/components/PrintButton";
import { dec } from "@/domain/money";
import { formatMoney } from "@/lib/format";
import { partnerAccount } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../../../shell";
import Link from "next/link";
import { Card, Cur, EmptyState, PageHeader, RoleBadge, Stat, StatusBadge } from "@/components/ui";
import { ExportButton } from "@/components/ExportButton";

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
  const f = await getTranslations({ locale, namespace: "Forms" });
  const v = await partnerAccount(db, actor, id);
  if (!v) notFound();
  const m = (a: string, c: string) => (a === "0" ? "" : formatMoney(a, c, locale));
  const bal = (a: string, c: string) => <span className={dec(a).lt(0) ? "state-missing" : ""}>{formatMoney(dec(a).abs().toString(), c, locale)} {dec(a).isZero() ? "" : dec(a).gt(0) ? t("owesUs") : t("weOwe")}</span>;
  return (
    <Shell wide permissions={actor.permissions} locale={locale} userName={user.displayName} path={`/finance/partners/${id}`} crumb={v.partner.name}>
      <PageHeader
        back={{ href: `/${locale}/finance/partners`, label: t("title") }}
        eyebrow={v.roles.map((x) => <RoleBadge key={x} role={x} label={s(`role_${x}`)} />)}
        title={v.partner.name}
        subtitle={v.partner.phone && <span className="ltr">{v.partner.phone}</span>}
        actions={<><ExportButton label={f("export")} filename="evercrest-partner-account" /><PrintButton label={t("print")} /></>}
      />
      <div className="stats">
        {Object.entries(v.balances).length === 0 && <Stat label={t("balance")} value="—" icon="wallet" />}
        {Object.entries(v.balances).map(([c, a]) => (
          <Stat key={c} label={`${t("balance")} ${c}`} value={formatMoney(dec(a).abs().toString(), c, locale)} hint={dec(a).isZero() ? "" : dec(a).gt(0) ? t("owesUs") : t("weOwe")} icon="wallet" tone={dec(a).gt(0) ? "success" : dec(a).lt(0) ? "warning" : undefined} />
        ))}
      </div>
      {v.claims.length > 0 && (
        <Card flush title={t("claims")} icon="clipboard">
          <div className="table-wrap"><table className="dense">
            <thead><tr><th>{t("claimNo")}</th><th>{t("date")}</th><th>{t("job")}</th><th className="num">{t("trips")}</th><th className="num">{t("claimTotal")}</th><th className="num">{t("open")}</th><th>{t("status")}</th></tr></thead>
            <tbody>{v.claims.map((c) => (
              <tr key={c.id}>
                <td className="ltr"><Link href={`/${locale}/claims/${c.id}`} className="cell-title">{c.claimNo}</Link></td><td className="ltr">{c.claimDate}</td><td className="ltr">{c.jobNo}</td><td className="num">{c.tripCount}</td>
                <td className="num">{formatMoney(c.totalFinal, c.currency, locale)}</td><td className="num">{c.open !== "0" ? <strong>{formatMoney(c.open, c.currency, locale)}</strong> : "—"}</td><td><StatusBadge status={c.status} label={t(`claim_${c.status}`)} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        </Card>
      )}
      <Card flush title={t("history")} icon="history">
      {v.lines.length === 0 ? <EmptyState icon="history" title={t("noHistory")} /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>{t("date")}</th><th>{t("document")}</th><th>{t("detail")}</th><th>{t("account")}</th><th>{t("currency")}</th><th className="num">{t("debit")}</th><th className="num">{t("credit")}</th><th className="num">{t("balance")}</th></tr></thead>
          <tbody>{v.lines.map((l) => (
            <tr key={l.id}>
              <td>{l.date}</td><td dir="ltr">{l.source ?? `#${l.entryNo}`}</td>
              <td className="wrap" dir="auto" style={{ minWidth: 150 }}>{l.description}{l.jobNo ? ` · ${l.jobNo}` : ""}</td>
              <td className="wrap">{l.account}</td><td><Cur code={l.currency} /></td>
              <td className="num">{m(l.debit, l.currency)}</td><td className="num">{m(l.credit, l.currency)}</td>
              <td className="num">{bal(l.balance, l.currency)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      </Card>
    </Shell>
  );
}
