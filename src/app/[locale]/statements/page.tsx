import { eq } from "drizzle-orm";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { ActionForm } from "@/components/ActionForm";
import { formatMoney } from "@/lib/format";
import { statementsOverview } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../shell";

export const dynamic = "force-dynamic";

export default async function Statements({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const t = await getTranslations({ locale, namespace: "Statements" });
  const f = await getTranslations({ locale, namespace: "Forms" });
  const o = await statementsOverview(db, actor);
  const today = new Date().toISOString().slice(0, 10);
  const m = (a: string, c: string) => formatMoney(a, c, locale);

  return (
    <Shell permissions={actor.permissions} locale={locale} userName={user.displayName} path="/statements">
      <h1>{t("title")}</h1>
      <p className="muted">{t("intro")}</p>

      {(["driver", "transporter"] as const).map((party) => (
        <details key={party} className="panel" open={party === "driver" && o.awaiting.driver.length > 0}>
          <summary>{t(`new_${party}`)} ({o.awaiting[party].length})</summary>
          {o.awaiting[party].length === 0 ? <p className="muted">{t("noneWaiting")}</p> : (
            <ActionForm command="statements.create" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("create")} redirectTo={`/${locale}/statements/{id}`}>
              <input type="hidden" name="party" value={party} />
              <div className="table-wrap"><table>
                <thead><tr><th /><th>{t("payee")}</th><th>{t("trip")}</th><th>{t("job")}</th><th>{t("date")}</th><th className="num">{t("net")}</th></tr></thead>
                <tbody>{o.awaiting[party].map((r) => (
                  <tr key={r.settlementId}>
                    <td><input type="checkbox" name="settlementIds[]" value={r.settlementId} aria-label={r.tripNo} /></td>
                    <td>{r.payee}</td><td dir="ltr">{r.tripNo}</td><td dir="ltr">{r.jobNo}</td><td>{r.loadingDate}</td>
                    <td className="num">{m(r.net, r.currency)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
              <div className="grid2">
                <label>{f("date")}<input type="date" name="statementDate" required defaultValue={today} /></label>
                <label>{t("notes")}<input name="notes" /></label>
              </div>
            </ActionForm>
          )}
        </details>
      ))}

      <h2>{t("list")}</h2>
      {o.list.length === 0 ? <p className="card muted">{t("none")}</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>{t("number")}</th><th>{t("party")}</th><th>{t("date")}</th><th className="num">{t("total")}</th><th>{t("status")}</th></tr></thead>
          <tbody>{o.list.map((s) => (
            <tr key={s.id}>
              <td dir="ltr"><Link href={`/${locale}/statements/${s.id}`}>{s.statementNo}</Link></td>
              <td>{t(`party_${s.party}`)}</td><td>{s.statementDate}</td>
              <td className="num">{m(s.total, s.currency)}</td>
              <td><span className={`badge ${s.status === "paid" ? "state-verified" : ""}`}>{t(`status_${s.status}`)}</span></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Shell>
  );
}
