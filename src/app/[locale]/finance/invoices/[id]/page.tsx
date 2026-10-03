import { eq } from "drizzle-orm";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { PrintButton } from "@/components/PrintButton";
import { dec, toStr } from "@/domain/money";
import { formatMoney, formatQty } from "@/lib/format";
import { invoiceView } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../../../shell";

export const dynamic = "force-dynamic";

/** One invoice with every line. Trip lines show the driver, truck and quantities of that trip. */
export default async function InvoicePage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const t = await getTranslations({ locale, namespace: "Invoice" });
  const fin = await getTranslations({ locale, namespace: "Finance" });
  const v = await invoiceView(db, actor, id);
  const inv = v.invoice;
  const m = (a: string) => formatMoney(a, inv.currency, locale);
  const hasTrips = v.tripCount > 0;

  return (
    <Shell wide permissions={actor.permissions} locale={locale} userName={user.displayName} path={`/finance/invoices/${id}`}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 dir="auto">{t("title", { no: inv.invoiceNo })}</h1>
        <PrintButton label={t("print")} />
      </div>
      <dl className="kv card">
        <dt>{inv.kind === "sales" ? t("customer") : t("partner")}</dt><dd>{v.partner}</dd>
        <dt>{t("date")}</dt><dd>{inv.invoiceDate}</dd>
        {inv.dueDate && <><dt>{t("due")}</dt><dd>{inv.dueDate}</dd></>}
        {hasTrips && <><dt /><dd>{t("summary", { trips: v.tripCount, drivers: v.driverCount })}</dd></>}
        {inv.status === "cancelled" && <><dt /><dd><span className="badge">{t("cancelled")}</span></dd></>}
      </dl>

      <div className="table-wrap"><table>
        <thead>
          <tr>
            <th>{t("line")}</th>
            {hasTrips && <><th>{t("trip")}</th><th>{t("driver")}</th><th>{t("truck")}</th><th className="num">{t("loaded")}</th><th className="num">{t("discharged")}</th></>}
            <th>{t("description")}</th><th className="num">{t("quantity")}</th><th className="num">{t("price")}</th><th className="num">{t("amount")}</th>
          </tr>
        </thead>
        <tbody>
          {v.lines.map(({ line, trip, driver, plate }) => (
            <tr key={line.id}>
              <td>{line.lineNo}</td>
              {hasTrips && (
                <>
                  <td dir="ltr">{trip?.tripNo ?? "—"}</td><td>{driver ?? "—"}</td><td dir="ltr">{plate ?? "—"}</td>
                  <td className="num">{trip?.loadedQty ? formatQty(toStr(dec(trip.loadedQty)), trip.loadedUnit!, locale) : "—"}</td>
                  <td className="num">{trip?.dischargedQty ? formatQty(toStr(dec(trip.dischargedQty)), trip.dischargedUnit!, locale) : "—"}</td>
                </>
              )}
              <td dir="auto">{line.description}</td>
              <td className="num">{line.unit ? formatQty(line.quantity, line.unit, locale) : line.quantity}</td>
              <td className="num">{m(line.unitPrice)}</td>
              <td className="num">{m(line.amount)}</td>
            </tr>
          ))}
          {inv.rounding !== "0" && (
            <>
              <tr className="subtotal"><td colSpan={hasTrips ? 9 : 4}>{t("linesTotal")}</td><td className="num">{m(v.linesTotal)}</td></tr>
              <tr><td colSpan={hasTrips ? 9 : 4}>{t("rounding")}</td><td className="num">{m(toStr(dec(inv.rounding).neg()))}</td></tr>
            </>
          )}
          <tr className="subtotal"><td colSpan={hasTrips ? 9 : 4}><strong>{t("total")}</strong></td><td className="num"><strong>{m(inv.total)}</strong></td></tr>
          {inv.status === "posted" && <tr><td colSpan={hasTrips ? 9 : 4}>{t("outstanding")}</td><td className="num">{m(v.outstanding)}</td></tr>}
        </tbody>
      </table></div>
      <p className="no-print"><Link href={`/${locale}/finance`}>← {fin("title")}</Link></p>
    </Shell>
  );
}
