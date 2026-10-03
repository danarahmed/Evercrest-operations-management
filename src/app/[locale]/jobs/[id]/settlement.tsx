import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/ActionForm";
import { formatMoney, formatQty } from "@/lib/format";
import type { PartySettlement, SettlementCalculation } from "@/domain/transport/settlement";

type TripView = {
  trip: { id: string; tripNo: string; status: string };
  billed: boolean;
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
    <div className="stack">
      <strong>{title}</strong>
      {p.lines.map((l) => <div key={l.code} className="row" style={{ justifyContent: "space-between" }}><span>{t(`line_${l.code}`)}</span><span className="num">{m(l.amount, p.currency)}</span></div>)}
      {p.advancesDeducted !== "0" && <div className="row" style={{ justifyContent: "space-between" }}><span>{t("advances")}</span><span className="num">{m(`-${p.advancesDeducted}`, p.currency)}</span></div>}
      {Object.entries(p.advancesOtherCurrency).map(([c, a]) => <div key={c} className="muted">{t("otherCurrencyAdvance", { amount: m(a, c) })}</div>)}
      {p.rounding !== "0" && <div className="row muted" style={{ justifyContent: "space-between" }}><span>{t("rounding")}</span><span className="num">{m(`-${p.rounding}`, p.currency)}</span></div>}
      <div className="row" style={{ justifyContent: "space-between" }}><strong>{t("net")}</strong><strong className="num">{m(p.netFinal, p.currency)}</strong></div>
    </div>
  );
  const body = (c: SettlementCalculation) => (
    <>
      <div className="muted">
        {t("quantities", { loaded: formatQty(c.quantities.loaded, c.quantities.unit, locale), discharged: formatQty(c.quantities.discharged, c.quantities.unit, locale), actual: formatQty(c.quantities.actual, c.quantities.unit, locale) })}
        {c.quantities.loss !== "0" && <> · {t("shortage", { loss: formatQty(c.quantities.loss, c.quantities.unit, locale), allowance: c.allowance ? formatQty(c.allowance, c.quantities.unit, locale) : "—", chargeable: formatQty(c.chargeableShortage, c.quantities.unit, locale) })}</>}
        {c.demurrageDays !== null && <> · {t("demurrageDays", { days: c.demurrageDays })}</>}
      </div>
      <div className="grid2">
        {party(t("driver"), c.driver)}
        {c.transporter && party(t("transporter"), c.transporter)}
      </div>
    </>
  );
  const unbilled = relevant.filter((x) => !x.billed);

  return (
    <>
      <h2>{t("title")}</h2>
      <div className="stack">
        {relevant.map((x) => (
          <div key={x.trip.id} className="card stack">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>{x.trip.tripNo}</strong>
              <span>
                {x.settlement ? <span className="badge state-verified">{t("settled", { no: x.settlement.no })}</span> : <span className="badge">{t("notSettled")}</span>}{" "}
                {x.billed ? <span className="badge state-verified">{t("billed")}</span> : <span className="badge">{t("notBilled")}</span>}
              </span>
            </div>
            {x.settlement && body(x.settlement.calc)}
            {x.preview && !x.preview.ok && (
              <ul className="alerts">{x.preview.missing.map((mm, i) => <li key={i} className="alert warning">{mm.message}</li>)}</ul>
            )}
            {x.preview && x.preview.ok && (
              <>
                {body(x.preview.calc)}
                {canSettle && (
                  <ActionForm command="settlements.create" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("settle")}>
                    <input type="hidden" name="tripId" value={x.trip.id} />
                    <label>{f("date")}<input type="date" name="settlementDate" required defaultValue={today} /></label>
                  </ActionForm>
                )}
              </>
            )}
          </div>
        ))}
      </div>
      {canBill && unbilled.length > 0 && (
        <details className="panel">
          <summary>{t("billCustomer")}</summary>
          <ActionForm command="billing.bill_trips" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("createInvoice")}>
            <input type="hidden" name="jobId" value={jobId} />
            <fieldset className="row"><legend>{t("tripsToBill")}</legend>
              {unbilled.map((x) => <label key={x.trip.id} className="row"><input type="checkbox" name="tripIds[]" value={x.trip.id} defaultChecked />{x.trip.tripNo}</label>)}
            </fieldset>
            <div className="grid2">
              <label>{f("date")}<input type="date" name="invoiceDate" required defaultValue={today} /></label>
              <label>{t("dueDate")}<input type="date" name="dueDate" /></label>
            </div>
          </ActionForm>
        </details>
      )}
    </>
  );
}
