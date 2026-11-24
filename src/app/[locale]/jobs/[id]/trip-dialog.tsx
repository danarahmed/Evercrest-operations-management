import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/ActionForm";
import { OpenDialog } from "@/components/trips/OpenDialog";
import { Badge } from "@/components/ui";
import { formatMoney, formatQty, intlLocale } from "@/lib/format";
import type { FormOptions, tripDetail } from "@/server/queries";

type Detail = NonNullable<Awaited<ReturnType<typeof tripDetail>>>;

/**
 * One screen for a trip: every field, the money as calculated, and the change
 * history (who changed what, from what to what). Also used to start a new trip
 * (detail = null).
 */
export async function TripDialog({ locale, jobId, detail, closeHref, options, routes, advancesEnabled, canEdit }: {
  locale: string;
  jobId: string;
  detail: Detail | null;
  closeHref: string;
  options: FormOptions;
  routes: { id: string; name: string }[];
  advancesEnabled: boolean;
  canEdit: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "TripForm" });
  const tr = await getTranslations({ locale, namespace: "Trips" });
  const f = await getTranslations({ locale, namespace: "Forms" });
  const trip = detail?.trip ?? null;
  const line = detail?.line ?? null;
  const c = line?.calc ?? null;
  const dtf = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short" });
  const m = (a: string | null, cur: string) => (a === null ? "—" : formatMoney(a, cur, locale));
  const locked = !!detail && !canEdit;
  const n = (x: string) => String(Number(x));
  const actionLabel = (action: string, changed: boolean) => {
    if (action === "trips.save") return changed ? t("changed") : t("created");
    if (action === "trips.create" || action === "trips.import_create") return t("created");
    if (action === "trips.import_update") return t("importedUpdate");
    if (action === "trips.record_loading") return t("recordedLoading");
    if (action === "trips.record_discharge") return t("recordedDischarge");
    if (action === "trips.record_arrival") return t("recordedArrival");
    if (action === "trips.cancel") return t("cancelledTrip");
    return action;
  };
  const FIELD_LABEL: Record<string, string> = {
    manifestNo: t("manifest"), routeId: t("route"), loadingDate: t("loadingDate"), loadedQty: t("loadedQty"), arrivalDate: t("arrivalDate"), dischargeDate: t("dischargeDate"), dischargedQty: t("dischargedQty"),
    driverId: t("driver"), transporterId: t("transporter"), truckId: t("plate"), plateText: t("plate"), carrierPriceOverride: t("priceOverride"), rewardOverride: t("rewardOverride"), transporterCut: t("transporterCut"), carrierDeduction: t("carrierDeduction"), notes: t("notes"), status: tr("state"),
  };
  return (
    <OpenDialog title={trip ? <><span className="ltr">{trip.manifestNo ?? trip.tripNo}</span>{line && <> · {line.driver}</>}</> : t("newTrip")} closeHref={closeHref}>
      <div className="grid side">
        <div>
          <ActionForm command="trips.save" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={trip ? f("save") : t("create")} summary={t("approvalSummary", { trip: trip?.manifestNo ?? trip?.tripNo ?? t("newTrip") })}>
            {trip ? <input type="hidden" name="tripId" value={trip.id} /> : <input type="hidden" name="jobId" value={jobId} />}
            <input type="hidden" name="transporterClear" value="1" />
            <fieldset disabled={locked}>
              <legend>{t("identity")}</legend>
              <div className="grid2">
                <label>{t("manifest")}<input name="manifestNo" defaultValue={trip?.manifestNo ?? ""} dir="ltr" /></label>
                <label>{t("route")}<select name="routeId" defaultValue={trip?.routeId ?? ""}><option value="">{t("chooseRoute")}</option>{routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
                <label>{t("orNewRoute")}<input name="routeName" /></label>
                <label>{t("loadingDate")}<input type="date" name="loadingDate" defaultValue={trip?.loadingDate ?? new Date().toISOString().slice(0, 10)} /></label>
                <label>{t("loadedQty")} <span className="hint">{line?.calc?.unit ?? trip?.loadedUnit ?? "MT"}</span><input name="loadedQty" inputMode="decimal" dir="ltr" defaultValue={trip?.loadedQty ? String(Number(trip.loadedQty)) : ""} /></label>
              </div>
            </fieldset>
            <fieldset disabled={locked}>
              <legend>{t("people")}</legend>
              <div className="grid2">
                <label>{t("driver")}<select name="driverId" defaultValue={trip?.driverId ?? ""}><option value="">{f("choose")}</option>{options.drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
                <label>{t("orNewDriver")}<input name="driverName" /></label>
                <label>{t("transporter")}<select name="transporterId" defaultValue={trip?.transporterId ?? ""}><option value="">{t("direct")}</option>{options.transporters.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
                <label>{t("orNewTransporter")}<input name="transporterName" /></label>
                <label>{t("plate")}<input name="plate" dir="ltr" defaultValue={trip?.plateText ?? line?.plate ?? ""} /></label>
              </div>
            </fieldset>
            <fieldset disabled={locked}>
              <legend>{t("money")}</legend>
              <div className="grid2">
                <label>{t("priceOverride")} <span className="hint">{c?.carrier.price && !trip?.carrierPriceOverride ? t("ruleIs", { value: n(c.carrier.price) }) : f("optional")}</span><input name="carrierPriceOverride" inputMode="decimal" dir="ltr" defaultValue={trip?.carrierPriceOverride ? String(Number(trip.carrierPriceOverride)) : ""} /></label>
                <label>{t("rewardOverride")} <span className="hint">{f("optional")}</span><input name="rewardOverride" inputMode="decimal" dir="ltr" defaultValue={trip?.rewardOverride ? String(Number(trip.rewardOverride)) : ""} /></label>
                <label>{t("transporterCut")} <span className="hint">{t("transporterCutHint")}</span><input name="transporterCut" inputMode="decimal" dir="ltr" defaultValue={trip ? String(Number(trip.transporterCut)) : "0"} /></label>
                <label>{t("carrierDeduction")} <span className="hint">{t("carrierDeductionHint")}</span><input name="carrierDeduction" inputMode="decimal" dir="ltr" defaultValue={trip ? String(Number(trip.carrierDeduction)) : "0"} /></label>
                {advancesEnabled && (<>
                  <label>{t("newAdvance")} <span className="hint">{f("optional")}</span><input name="advanceAmount" inputMode="decimal" dir="ltr" /></label>
                  <label>{t("paidFrom")}<select name="advanceMoneyAccountId" defaultValue=""><option value="">{f("choose")}</option>{options.moneyAccounts.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.currency})</option>)}</select></label>
                </>)}
              </div>
            </fieldset>
            {options.feeTypes.length > 0 && (
              <fieldset disabled={locked}>
                <legend>{t("feesLegend")}</legend>
                <input type="hidden" name="feesShown" value="1" />
                <p className="muted small !m-0 basis-full">{t("feesHelp")}</p>
                <div className="grid2 basis-full">
                  {options.feeTypes.map((ft) => {
                    const has = detail?.fees.find((x) => x.feeTypeId === ft.id);
                    return (
                      <div key={ft.id} className="flex items-end gap-2">
                        <label className="check min-w-0 flex-1 pb-2"><input type="checkbox" name={`fee_${ft.id}`} defaultChecked={!!has} disabled={!!has?.paymentId} />
                          <span className="min-w-0">{ft.name}{has?.paymentId ? <span className="muted small"> · {t("feePaid")}</span> : ft.paidBy === "customer" ? <span className="muted small"> · {t("feeByCustomer")}</span> : null}</span>
                        </label>
                        {has?.paymentId && <input type="hidden" name={`fee_${ft.id}`} value="on" />}
                        <label className="w-28 flex-none">{ft.defaultBasis === "per_trip" ? t("feeAmount") : t("feePerUnit")}<input name={`feeAmount_${ft.id}`} inputMode="decimal" dir="ltr" readOnly={!!has?.paymentId} defaultValue={has ? String(Number(has.rate)) : ft.defaultAmount ? String(Number(ft.defaultAmount)) : ""} /></label>
                      </div>
                    );
                  })}
                </div>
              </fieldset>
            )}
            <fieldset disabled={locked}>
              <legend>{t("later")}</legend>
              <div className="grid2">
                <label>{t("arrivalDate")}<input type="date" name="arrivalDate" defaultValue={trip?.arrivalDate ?? ""} /></label>
                <label>{t("dischargeDate")}<input type="date" name="dischargeDate" defaultValue={trip?.dischargeDate ?? ""} /></label>
                <label>{t("dischargedQty")}<input name="dischargedQty" inputMode="decimal" dir="ltr" defaultValue={trip?.dischargedQty ? String(Number(trip.dischargedQty)) : ""} /></label>
                <label>{t("notes")}<input name="notes" defaultValue={trip?.notes ?? ""} /></label>
                {trip && <label>{t("reason")} <span className="hint">{t("reasonHint")}</span><input name="reason" /></label>}
              </div>
            </fieldset>
          </ActionForm>
        </div>
        {detail && (
          <div className="stack">
            {line?.claim && (
              <div className="banner success" style={{ margin: 0 }}><Badge tone="success" plain>{t("claimedTitle")}</Badge>
                <div>{t("claimedOn")} <a href={`/${locale}/claims/${line.claim.id}`} className="ltr"><strong>{line.claim.claimNo}</strong></a> · {t("claimedLocked")}</div>
              </div>
            )}
            {c && (
              <div className="card" style={{ margin: 0, boxShadow: "none" }}>
                <div className="card-head"><div className="card-title">{t("asCalculated")}</div>{c.state === "confirmed" ? <Badge tone="success">{tr("confirmed")}</Badge> : <Badge tone="warning">{tr("estimated")}</Badge>}</div>
                <div className="card-body">
                  <div className="amount-line"><span>{tr("net")}</span><span className="num">{formatQty(c.net, c.unit, locale)}</span></div>
                  <div className="amount-line"><span>{t("freight")}</span><span className="num">{m(c.carrier.freight, c.currency)}</span></div>
                  {c.carrier.reward !== "0" && <div className="amount-line"><span>{t("reward")}</span><span className="num">{m(c.carrier.reward, c.currency)}</span></div>}
                  {c.carrier.fineFull !== "0" && c.carrier.fineFull !== c.carrier.fine && <div className="amount-line muted"><span>{t("fineBeforeWaiver")}</span><span className="num">{m(c.carrier.fineFull, c.currency)}</span></div>}
                  {c.carrier.fineWaived !== "0" && <div className="amount-line"><span>{t("fineWaived")}</span><span className="num">{m(c.carrier.fineWaived, c.currency)}</span></div>}
                  {c.carrier.fine !== "0" && <div className="amount-line"><span>{tr("fine")}</span><span className="num neg">{m(c.carrier.fine, c.currency)}</span></div>}
                  {c.carrier.feeDeductions !== "0" && <div className="amount-line"><span>{t("feeDeductions")}</span><span className="num">−{m(c.carrier.feeDeductions, c.currency)}</span></div>}
                  {c.carrier.transporterCut !== "0" && <div className="amount-line"><span>{t("transporterCut")}</span><span className="num">−{m(c.carrier.transporterCut, c.currency)}</span></div>}
                  {c.carrier.otherDeduction !== "0" && <div className="amount-line"><span>{t("carrierDeduction")}</span><span className="num">−{m(c.carrier.otherDeduction, c.currency)}</span></div>}
                  <div className="amount-line total"><span>{tr("carrierPay")}</span><span className="num">{m(c.carrier.total, c.currency)}</span></div>
                  <div className="amount-line"><span>{tr("advance")}</span><span className="num">−{m(c.carrier.advance, c.currency)}</span></div>
                  <div className="amount-line total"><span>{tr("toPay")}</span><span className="num">{m(c.carrier.toPay, c.currency)}</span></div>
                  {c.fees.length > 0 && <div className="divider" />}
                  {c.fees.map((fee) => <div key={fee.feeTypeId} className="amount-line muted"><span>{fee.name}</span><span className="num">{formatMoney(fee.amount, fee.currency, locale)}</span></div>)}
                  <div className="amount-line total"><span>{tr("cost")}</span><span className="num">{m(c.cost, c.currency)}</span></div>
                  {detail.showProfit && <><div className="amount-line"><span>{tr("billed")}</span><span className="num">{m(c.customer.total, c.currency)}</span></div><div className="amount-line total"><span>{tr("margin")}</span><span className="num">{m(c.margin, c.currency)}</span></div></>}
                </div>
              </div>
            )}
            {c && (detail.canWaive || detail.waivers.length > 0) && (
              <div className="card" style={{ margin: 0, boxShadow: "none" }}>
                <div className="card-head"><div className="card-title">{t("waiverTitle")}</div></div>
                <div className="card-body stack" style={{ gap: 10 }}>
                  {detail.waivers.map((w) => <div key={w.id} className="small"><strong>{m(w.amount, w.currency)}</strong> · {w.waiverDate} — <em className="muted">{w.reason}</em></div>)}
                  {detail.canWaive && (
                    <ActionForm approvalOnly command="fines.waive" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("waiverSubmit")} summary={t("waiverSummary", { trip: trip?.manifestNo ?? trip?.tripNo ?? "" })} variant="secondary">
                      <input type="hidden" name="tripId" value={trip!.id} />
                      <input type="hidden" name="waiverDate" value={new Date().toISOString().slice(0, 10)} />
                      <p className="muted small" style={{ margin: 0 }}>{t("waiverHelp", { fine: m(c.carrier.fine, c.currency) })}</p>
                      <div className="grid2">
                        <label>{t("waiverAmount")} <span className="hint">{t("waiverAmountHint")}</span><input name="amount" inputMode="decimal" dir="ltr" /></label>
                        <label>{t("reason")}<input name="reason" required /></label>
                      </div>
                    </ActionForm>
                  )}
                </div>
              </div>
            )}
            <div className="card" style={{ margin: 0, boxShadow: "none" }}>
              <div className="card-head"><div className="card-title">{t("history")}</div></div>
              <div className="card-body stack" style={{ gap: 10 }}>
                {detail.history.advances.map(({ p, by }) => (
                  <div key={p.id} className="small">
                    <div><strong>{t("advancePaid", { amount: formatMoney(p.amount, p.currency, locale) })}</strong> {p.status === "reversed" && <Badge tone="danger" plain>{t("reversed")}</Badge>}</div>
                    <div className="muted">{p.paymentDate} · {by ?? "—"} · <span className="ltr">{p.paymentNo}</span></div>
                    {p.status !== "reversed" && detail.canReverse && !line?.claim && (
                      <details className="inline-reverse">
                        <summary>{t("reverseAdvance")}</summary>
                        <ActionForm command="payments.reverse" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("reverseSubmit")} variant="danger">
                          <input type="hidden" name="paymentId" value={p.id} />
                          <input type="hidden" name="reversalDate" value={new Date().toISOString().slice(0, 10)} />
                          <label>{t("reverseReason")}<input name="reason" required /></label>
                        </ActionForm>
                      </details>
                    )}
                  </div>
                ))}
                {detail.history.changes.map(({ e, by }) => {
                  const before = (e.before ?? {}) as Record<string, unknown>;
                  const after = (e.after ?? {}) as Record<string, unknown>;
                  const keys = Object.keys(after).filter((k) => k in FIELD_LABEL);
                  return (
                    <div key={e.id} className="small">
                      <div><strong>{actionLabel(e.action, !!e.before)}</strong>{e.reason ? <em className="muted"> — {e.reason}</em> : null}</div>
                      <div className="muted">{dtf.format(e.createdAt)} · {by ?? "—"}</div>
                      {!!e.before && keys.length > 0 && (
                        <div className="history-diff">
                          {keys.map((k) => <div key={k} style={{ display: "contents" }}><span className="muted">{FIELD_LABEL[k]}</span><span><span className="old">{String(before[k] ?? "—")}</span> → <strong>{String(after[k] ?? "—")}</strong></span></div>)}
                        </div>
                      )}
                    </div>
                  );
                })}
                {detail.history.changes.length === 0 && <p className="muted small">{t("noHistory")}</p>}
              </div>
            </div>
          </div>
        )}
      </div>
    </OpenDialog>
  );
}
