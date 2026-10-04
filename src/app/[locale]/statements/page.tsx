import { eq } from "drizzle-orm";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { ActionForm } from "@/components/ActionForm";
import { Card, EmptyState, PageHeader, Stat, StatusBadge, Tabs } from "@/components/ui";
import { dec } from "@/domain/money";
import { formatMoney } from "@/lib/format";
import { statementsOverview } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../shell";

export const dynamic = "force-dynamic";

/** Pay statements: settled trips waiting to be paid, statements made, and what payees owe. */
export default async function Statements({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ tab?: string; transporter?: string }> }) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const t = await getTranslations({ locale, namespace: "Statements" });
  const f = await getTranslations({ locale, namespace: "Forms" });
  const o = await statementsOverview(db, actor);
  const today = new Date().toISOString().slice(0, 10);
  const m = (a: string, c: string) => formatMoney(a, c, locale);
  const tab = ["driver", "transporter", "list", "owed"].includes(sp.tab ?? "") ? sp.tab! : "driver";
  const base = `/${locale}/statements`;
  // Drivers can be grouped any way: filter by the transporter they drove for, or mix freely.
  const transporterOptions = [...new Map(o.awaiting.driver.filter((r) => r.transporterId).map((r) => [r.transporterId!, r.transporter!])).entries()];
  const transporter = sp.transporter;
  const drivers = o.awaiting.driver.filter((r) => !transporter || (transporter === "none" ? !r.transporterId : r.transporterId === transporter));
  const awaiting = { driver: drivers, transporter: o.awaiting.transporter };
  const open = o.list.filter((s) => s.status === "open");

  const waitingTable = (party: "driver" | "transporter") => (
    <Card
      flush
      title={t(`new_${party}`)}
      subtitle={t("pickTrips")}
      actions={party === "driver" && transporterOptions.length > 0 && (
        <div className="chips">
          <Link href={`${base}?tab=driver`} className={`chip${!transporter ? " badge accent" : ""}`}>{t("all")}</Link>
          {transporterOptions.map(([tid, name]) => <Link key={tid} href={`${base}?tab=driver&transporter=${tid}`} className={`chip${transporter === tid ? " badge accent" : ""}`}>{name}</Link>)}
          <Link href={`${base}?tab=driver&transporter=none`} className={`chip${transporter === "none" ? " badge accent" : ""}`}>{t("direct")}</Link>
        </div>
      )}
    >
      {awaiting[party].length === 0 ? <EmptyState icon="checkCircle" title={t("noneWaiting")} /> : (
        <div style={{ padding: "0 0 16px" }}>
          <ActionForm command="statements.create" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("create")} redirectTo={`/${locale}/statements/{id}`}>
            <input type="hidden" name="party" value={party} />
            <div className="table-wrap"><table>
              <thead><tr><th style={{ width: 40 }} /><th>{t("payee")}</th>{party === "driver" && <th>{t("transporter")}</th>}<th>{t("trip")}</th><th>{t("job")}</th><th>{t("date")}</th><th className="num">{t("net")}</th></tr></thead>
              <tbody>{awaiting[party].map((r) => (
                <tr key={r.settlementId}>
                  <td><input type="checkbox" name="settlementIds[]" value={r.settlementId} aria-label={r.tripNo} /></td>
                  <td className="cell-title">{r.payee}</td>{party === "driver" && <td>{r.transporter ?? <span className="muted">{t("direct")}</span>}</td>}<td className="ltr">{r.tripNo}</td><td className="ltr">{r.jobNo}</td><td>{r.loadingDate}</td>
                  <td className={`num ${dec(r.net).lt(0) ? "neg" : ""}`}><strong>{m(r.net, r.currency)}</strong></td>
                </tr>
              ))}</tbody>
            </table></div>
            <div className="grid2" style={{ padding: "0 18px" }}>
              <label>{f("date")}<input type="date" name="statementDate" required defaultValue={today} /></label>
              <label>{t("notes")}<input name="notes" /></label>
            </div>
          </ActionForm>
        </div>
      )}
    </Card>
  );

  return (
    <Shell permissions={actor.permissions} locale={locale} userName={user.displayName} path="/statements">
      <PageHeader title={t("title")} subtitle={t("intro")} />
      <div className="stats">
        <Stat label={t("statDrivers")} value={o.awaiting.driver.length} icon="users" href={`${base}?tab=driver`} />
        <Stat label={t("statTransporters")} value={o.awaiting.transporter.length} icon="truck" tone="violet" href={`${base}?tab=transporter`} />
        <Stat label={t("statOpen")} value={open.length} icon="receipt" tone="warning" href={`${base}?tab=list`} />
        <Stat label={t("statOwed")} value={o.debts.length} icon="alert" tone="danger" href={`${base}?tab=owed`} />
      </div>
      <Tabs active={tab} items={[
        { key: "driver", label: t("tabDrivers"), href: `${base}?tab=driver`, count: o.awaiting.driver.length },
        { key: "transporter", label: t("tabTransporters"), href: `${base}?tab=transporter`, count: o.awaiting.transporter.length },
        { key: "list", label: t("list"), href: `${base}?tab=list`, count: o.list.length },
        { key: "owed", label: t("debtsTitle"), href: `${base}?tab=owed`, count: o.debts.length },
      ]} />

      {(tab === "driver" || tab === "transporter") && waitingTable(tab)}

      {tab === "list" && (
        <Card flush title={t("list")} icon="receipt">
          {o.list.length === 0 ? <EmptyState icon="receipt" title={t("none")} /> : (
            <div className="table-wrap"><table>
              <thead><tr><th>{t("number")}</th><th>{t("party")}</th><th>{t("date")}</th><th className="num">{t("total")}</th><th>{t("status")}</th></tr></thead>
              <tbody>{o.list.map((s) => {
                const status = s.status === "paid" && !dec(s.total).gt(0) ? "nothing" : s.status;
                return (
                  <tr key={s.id}>
                    <td className="ltr"><Link href={`/${locale}/statements/${s.id}`} className="cell-title">{s.statementNo}</Link></td>
                    <td>{t(`party_${s.party}`)}</td><td>{s.statementDate}</td>
                    <td className="num"><strong>{m(s.total, s.currency)}</strong></td>
                    <td><StatusBadge status={status === "open" ? "pending" : status} label={t(`status_${status}`)} /></td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          )}
        </Card>
      )}

      {tab === "owed" && (
        <Card flush title={t("debtsTitle")} subtitle={t("debtsHelp")} icon="alert">
          {o.debts.length === 0 ? <EmptyState icon="checkCircle" title={t("noDebts")} /> : (
            <div className="table-wrap"><table>
              <thead><tr><th>{t("payee")}</th><th>{t("party")}</th><th>{t("number")}</th><th>{t("date")}</th><th className="num">{t("debtAmount")}</th></tr></thead>
              <tbody>{o.debts.map((d) => (
                <tr key={`${d.statementId}${d.partnerId}`}>
                  <td className="cell-title">{d.name}</td><td>{t(`party_${d.party}`)}</td>
                  <td className="ltr"><Link href={`/${locale}/statements/${d.statementId}`}>{d.statementNo}</Link></td><td>{d.statementDate}</td>
                  <td className="num neg"><strong>{m(d.open, d.currency)}</strong></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      )}
    </Shell>
  );
}
