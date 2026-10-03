import { eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Fragment } from "react";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { ActionForm } from "@/components/ActionForm";
import { formatMoney } from "@/lib/format";
import { can } from "@/server/authz";
import { journalView } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../../shell";
import { FinanceNav } from "../nav";

export const dynamic = "force-dynamic";
const LINES = 4;

/** The books: every posted entry with its lines. Manual entries for accountants; corrections are reversals. */
export default async function JournalPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const t = await getTranslations({ locale, namespace: "Journal" });
  const f = await getTranslations({ locale, namespace: "Forms" });
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const from = sp.from ?? `${today.slice(0, 7)}-01`;
  const to = sp.to ?? today;
  const v = await journalView(db, actor, from, to);
  const m = (a: string, c: string) => (a === "0" ? "" : formatMoney(a, c, locale));

  return (
    <Shell wide permissions={actor.permissions} locale={locale} userName={user.displayName} path="/finance/journal">
      <h1>{t("title")}</h1>
      <FinanceNav locale={locale} current="journal" />
      <p className="muted">{t("intro")}</p>

      {can(actor, "journal.post") && (
        <details className="panel">
          <summary>{t("manual")}</summary>
          <p className="muted">{t("manualHelp")}</p>
          <ActionForm command="ledger.manual_entry" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("post")}>
            <div className="grid2">
              <label>{f("date")}<input type="date" name="entryDate" required defaultValue={today} /></label>
              <label>{f("description")}<input name="description" required /></label>
            </div>
            <div className="table-wrap"><table>
              <thead><tr><th>{t("account")}</th><th>{t("currency")}</th><th>{t("debit")}</th><th>{t("credit")}</th><th>{t("memo")}</th></tr></thead>
              <tbody>{Array.from({ length: LINES }, (_, i) => (
                <tr key={i}>
                  <td><select name="l_accountId[]" defaultValue=""><option value="">—</option>{v.accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}{a.currency ? ` (${a.currency})` : ""}</option>)}</select></td>
                  <td><select name="l_currency[]" defaultValue="IQD"><option value="IQD">IQD</option><option value="USD">USD</option></select></td>
                  <td><input name="l_debit[]" inputMode="decimal" dir="ltr" size={10} /></td>
                  <td><input name="l_credit[]" inputMode="decimal" dir="ltr" size={10} /></td>
                  <td><input name="l_memo[]" /></td>
                </tr>
              ))}</tbody>
            </table></div>
          </ActionForm>
        </details>
      )}

      <form className="row no-print" method="get">
        <label>{t("from")} <input type="date" name="from" defaultValue={from} /></label>
        <label>{t("to")} <input type="date" name="to" defaultValue={to} /></label>
        <button type="submit">{t("show")}</button>
      </form>

      {v.entries.length === 0 ? <p className="card muted">{t("none")}</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>{t("no")}</th><th>{f("date")}</th><th>{t("account")}</th><th>{t("detail")}</th><th className="num">{t("debit")}</th><th className="num">{t("credit")}</th></tr></thead>
          <tbody>{v.entries.map((e) => (
            <Fragment key={e.id}>
              <tr className="subtotal">
                <td dir="ltr">#{e.entryNo}</td><td>{e.entryDate}</td>
                <td colSpan={2} className="wrap">
                  <strong dir="auto">{e.description}</strong>
                  <span className="muted"> · {e.sourceType === "manual" ? t("manualBy", { name: e.by }) : e.sourceId ?? e.sourceType}</span>
                  {e.reversedByEntryId && <span className="badge">{t("reversed")}</span>}
                  {e.reversesEntryId && <span className="badge">{t("reversal")}</span>}
                </td>
                <td colSpan={2} className="no-print">
                  {can(actor, "journal.reverse") && e.sourceType === "manual" && !e.reversedByEntryId && !e.reversesEntryId && (
                    <details>
                      <summary>{t("reverse")}</summary>
                      <ActionForm command="ledger.reverse_entry" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("reverse")}>
                        <input type="hidden" name="entryId" value={e.id} />
                        <input type="date" name="entryDate" required defaultValue={today} />
                        <input name="reason" required placeholder={t("reason")} />
                      </ActionForm>
                    </details>
                  )}
                </td>
              </tr>
              {e.lines.map((l) => (
                <tr key={l.id}>
                  <td /><td />
                  <td>{l.code} · {l.account}</td>
                  <td className="muted wrap">{[l.partner, l.jobNo, l.memo].filter(Boolean).join(" · ")}</td>
                  <td className="num">{m(l.debit, l.currency)}</td><td className="num">{m(l.credit, l.currency)}</td>
                </tr>
              ))}
            </Fragment>
          ))}</tbody>
        </table></div>
      )}
    </Shell>
  );
}
