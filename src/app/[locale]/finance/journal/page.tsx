import { eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Fragment } from "react";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { ActionForm } from "@/components/ActionForm";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/Modal";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { ExportButton } from "@/components/ExportButton";

import { formatMoney } from "@/lib/format";
import { can } from "@/server/authz";
import { journalView } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../../shell";

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
      <PageHeader title={t("title")} subtitle={t("intro")} actions={<><ExportButton label={f("export")} filename="evercrest-journal" />{can(actor, "journal.post") && (
        <Modal label={t("manual")} variant="primary" size="lg" icon={<Icon name="plus" size={16} />}>
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
        </Modal>
      )}</>} />


      <form className="filters no-print" method="get">
        <label>{t("from")}<input type="date" name="from" defaultValue={from} /></label>
        <label>{t("to")}<input type="date" name="to" defaultValue={to} /></label>
        <button type="submit"><Icon name="search" size={16} />{t("show")}</button>
      </form>

      <Card flush title={t("entries", { count: v.entries.length })} icon="book">
      {v.entries.length === 0 ? <EmptyState icon="book" title={t("none")} /> : (
        <div className="table-wrap"><table className="dense">
          <thead><tr><th>{t("no")}</th><th>{f("date")}</th><th>{t("account")}</th><th>{t("detail")}</th><th className="num">{t("debit")}</th><th className="num">{t("credit")}</th></tr></thead>
          <tbody>{v.entries.map((e) => (
            <Fragment key={e.id}>
              <tr className="subtotal">
                <td dir="ltr">#{e.entryNo}</td><td>{e.entryDate}</td>
                <td colSpan={2} className="wrap">
                  <strong dir="auto">{e.description}</strong>
                  <span className="muted"> · {e.sourceType === "manual" ? t("manualBy", { name: e.by }) : e.sourceId ?? e.sourceType}</span>
                  {e.reversedByEntryId && <Badge tone="warning">{t("reversed")}</Badge>}
                  {e.reversesEntryId && <Badge tone="info">{t("reversal")}</Badge>}
                </td>
                <td colSpan={2} className="no-print">
                  {can(actor, "journal.reverse") && e.sourceType === "manual" && !e.reversedByEntryId && !e.reversesEntryId && (
                    <Modal label={t("reverse")} small size="sm" title={`${t("reverse")} #${e.entryNo}`}>
                      <ActionForm command="ledger.reverse_entry" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("reverse")}>
                        <input type="hidden" name="entryId" value={e.id} />
                        <div className="grid2">
                          <label>{t("date")}<input type="date" name="entryDate" required defaultValue={today} /></label>
                          <label>{t("reason")}<input name="reason" required /></label>
                        </div>
                      </ActionForm>
                    </Modal>
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
      </Card>
    </Shell>
  );
}
