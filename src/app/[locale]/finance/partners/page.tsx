import { eq } from "drizzle-orm";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { dec } from "@/domain/money";
import { formatMoney } from "@/lib/format";
import { partnersFinance } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../../shell";
import { Card, EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Who owes the company and whom the company owes, per currency. */
export default async function PartnersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const t = await getTranslations({ locale, namespace: "PartnerAccounts" });
  const s = await getTranslations({ locale, namespace: "Setup" });
  const rows = await partnersFinance(db, actor);
  const show = (a: string, c: string) => (
    <span><strong className={dec(a).gt(0) ? "money-pos" : "neg"}>{formatMoney(dec(a).abs().toString(), c, locale)}</strong> <span className="small muted">{dec(a).gt(0) ? t("owesUs") : t("weOwe")}</span></span>
  );
  return (
    <Shell permissions={actor.permissions} locale={locale} userName={user.displayName} path="/finance/partners">
      <PageHeader title={t("title")} subtitle={t("intro")} />
      <Card flush title={t("count", { count: rows.length })} icon="wallet">
      {rows.length === 0 ? <EmptyState icon="checkCircle" title={t("none")} /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>{t("partner")}</th><th>{t("roles")}</th><th className="num">IQD</th><th className="num">USD</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td><Link href={`/${locale}/finance/partners/${r.id}`} className="cell-title">{r.name}</Link></td>
              <td>{r.roles.map((x) => s(`role_${x}`)).join(", ")}</td>
              <td className="num">{r.balances.IQD ? show(r.balances.IQD, "IQD") : "—"}</td>
              <td className="num">{r.balances.USD ? show(r.balances.USD, "USD") : "—"}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      </Card>
    </Shell>
  );
}
