import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/ActionForm";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/Modal";
import { Badge, Card } from "@/components/ui";
import { formatMoney, formatQty } from "@/lib/format";
import type { PartySettlement, SettlementCalculation } from "@/domain/transport/settlement";

type TripView = {
  trip: { id: string; tripNo: string; status: string };
  driver?: string;
  billed: boolean;
  invoice: { id: string; no: string } | null;
  settlement: { no: string; calc: SettlementCalculation } | null;
  preview: { ok: true; calc: SettlementCalculation } | { ok: false; missing: { code: string; message: string }[] } | null;
};

/** Settlement and billing of a job's trips: what each party gets, what is missing, and the actions. */
export async function SettlementSection({ locale, jobId, trips, canSettle, canBill }: {
  locale: string;
  jobId: string;
  trips: TripView[];
  canSettle: boolean;
  canBill: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "Settle" });
  const f = await getTranslations({ locale, namespace: "Forms" });
  const today = new Date().toISOString().slice(0, 10);
  const relevant = trips.filter((x) => x.trip.status === "discharged");
  if (!relevant.length) return null;
  const m = (a: string, c: string) => formatMoney(a, c, locale);
  const party = (title: string, p: PartySettlement) => (
    <div>
      <div className="small muted" style={{ fontWeight: 650, marginBlockEnd: 4 }}>{title}</div>
      {p.lines.map((l) => <div key={l.code} className="amount-line"><span>{t(`line_${l.code}`)}</span><span className="num">{m(l.amount, p.currency)}</span></div>)}
      {p.advancesDeducted !== "0" && <div className="amount-line"><span>{t("advances")}</span><span className="num">{m(`-${p.advancesDeducted}`, p.currency)}</span></div>}
      {Object.entries(p.advancesOtherCurrency).map(([c, a]) => <div key={c} className="small muted">{t("otherCurrencyAdvance", { amount: m(a, c) })}</div>)}
      {p.rounding !== "0" && <div className="amount-line muted"><span>{t("rounding")}</span><span className="num">{m(`-${p.rounding}`, p.currency)}</span></div>}
      <div className="amount-line total"><span>{t("net")}</span><span className="num">{m(p.netFinal, p.currency)}</span></div>
    </div>
  );
  const body = (c: SettlementCalculation) => (
    <>
      <div className="chips" style={{ marginBlockEnd: 12 }}>
        <span className="chip">{t("loadedShort")}: {formatQty(c.quantities.loaded, c.quantities.unit, locale)}</span>
        <span className="chip">{t("dischargedShort")}: {formatQty(c.quantities.discharged, c.quantities.unit, locale)}</span>
        <span className="chip">{t("actualShort")}: <strong>&nbsp;{formatQty(c.quantities.actual, c.quantities.unit, locale)}</strong></span>
        {c.quantities.loss !== "0" && <span className="chip">{t("shortage", { loss: formatQty(c.quantities.loss, c.quantities.unit, locale), allowance: c.allowance ? formatQty(c.allowance, c.quantities.unit, locale) : "—", chargeable: formatQty(c.chargeableShortage, c.quantities.unit, locale) })}</span>}
        {c.demurrageDays !== null && <span className="chip">{t("demurrageDays", { days: c.demurrageDays })}</span>}
      </div>
      <div className="grid cols-2">
        {party(t("driver"), c.driver)}
        {c.transporter && party(t("transporter"), c.transporter)}
      </div>
    </>
  );
  const unbilled = relevant.filter((x) => !x.billed);

  return (
    <Card
      title={t("title")}
      icon="receipt"
      actions={canBill && unbilled.length > 0 && (
        <Modal label={t("billCustomer")} icon={<Icon name="receipt" size={16} />} variant="primary" small>
          <ActionForm command="billing.bill_trips" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("createInvoice")}>
            <input type="hidden" name="jobId" value={jobId} />
            <fieldset><legend>{t("tripsToBill")}</legend>
              {unbilled.map((x) => <label key={x.trip.id} className="check"><input type="checkbox" name="tripIds[]" value={x.trip.id} defaultChecked />{x.trip.tripNo}</label>)}
            </fieldset>
            <div className="grid2">
              <label>{f("date")}<input type="date" name="invoiceDate" required defaultValue={today} /></label>
              <label>{t("dueDate")}<input type="date" name="dueDate" /></label>
            </div>
          </ActionForm>
        </Modal>
      )}
    >
      <div className="stack" style={{ gap: 14 }}>
        {relevant.map((x) => (
          <div key={x.trip.id} className="card" style={{ margin: 0, boxShadow: "none" }} data-trip={x.trip.tripNo}>
            <div className="card-head">
              <div className="card-title"><Icon name="truck" /><strong className="ltr">{x.trip.tripNo}</strong>{x.driver && <span className="muted" style={{ fontWeight: 500 }}>· {x.driver}</span>}</div>
              <div className="row">
                {x.settlement ? <Badge tone="success">{t("settled", { no: x.settlement.no })}</Badge> : <Badge tone="warning">{t("notSettled")}</Badge>}
                {x.billed ? (
                  <Badge tone="success">{t("billed")}{x.invoice && <> · <Link href={`/${locale}/finance/invoices/${x.invoice.id}`} className="ltr">{x.invoice.no}</Link></>}</Badge>
                ) : <Badge>{t("notBilled")}</Badge>}
              </div>
            </div>
            <div className="card-body">
              {x.settlement && body(x.settlement.calc)}
              {x.preview && !x.preview.ok && (
                <div className="form-msg error"><strong>{t("cannotSettle")}</strong><ul>{x.preview.missing.map((mm, i) => <li key={i}>{mm.message}</li>)}</ul></div>
              )}
              {x.preview && x.preview.ok && (
                <>
                  {body(x.preview.calc)}
                  {canSettle && (
                    <div style={{ marginBlockStart: 14 }}>
                      <ActionForm command="settlements.create" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("settle")} inline confirm={t("settleConfirm", { trip: x.trip.tripNo })}>
                        <input type="hidden" name="tripId" value={x.trip.id} />
                        <input type="date" name="settlementDate" required defaultValue={today} aria-label={f("date")} />
                      </ActionForm>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
