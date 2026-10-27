import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/ActionForm";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/Modal";
import { Badge, Card, EmptyState } from "@/components/ui";
import { formatMoney, formatQty } from "@/lib/format";
import type { jobRuleCard } from "@/server/queries";

type RuleCard = Awaited<ReturnType<typeof jobRuleCard>>;
const key = () => crypto.randomUUID();
const today = () => new Date().toISOString().slice(0, 10);

/**
 * The job's rule card (design proposal §3): routes, dated prices and shortage
 * rules, and dated fees. The manager sets it; staff work inside it. Customer
 * prices and the customer side are shown only with profit.view.
 */
export async function RuleCardSection({ locale, jobId, card, units, expenseAccounts }: {
  locale: string;
  jobId: string;
  card: RuleCard;
  units: { code: string; name: string }[];
  expenseAccounts: { id: string; code: string; name: string }[];
}) {
  const t = await getTranslations({ locale, namespace: "Rules" });
  const f = await getTranslations({ locale, namespace: "Forms" });
  const m = (a: string | null, c: string) => (a === null ? <span className="muted">{t("tbd")}</span> : formatMoney(a, c, locale));
  const routeName = (id: string | null) => (id ? (card.routes.find((r) => r.id === id)?.name ?? "?") : t("allRoutes"));
  const feeName = (id: string) => card.allFeeTypes.find((x) => x.id === id)?.name ?? "?";
  const plus = <Icon name="plus" size={16} />;
  const latest = [...card.terms].reverse();
  const routeOptions = (
    <label>{t("route")}<select name="routeId" defaultValue=""><option value="">{t("allRoutes")}</option>{card.routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
  );
  const currencySelect = (
    <label>{f("currency")}<select name="currency" defaultValue="USD"><option value="USD">USD</option><option value="IQD">IQD</option></select></label>
  );

  return (
    <div className="stack">
      {!card.terms.length && <div className="banner"><Icon name="info" /><div><div className="banner-label">{t("noRulesTitle")}</div><div>{t("noRulesHelp")}</div></div></div>}

      <Card title={t("terms")} subtitle={t("termsHelp")} icon="sliders" flush actions={card.canManage && (
        <Modal label={t("newVersion")} variant="primary" icon={plus} size="lg">
          <ActionForm command="job_terms.set" locale={locale} idempotencyKey={key()} submitLabel={f("save")}>
            <input type="hidden" name="jobId" value={jobId} />
            <div className="grid2">
              <label>{t("from")}<input type="date" name="effectiveFrom" required defaultValue={today()} /></label>
              {routeOptions}
              {currencySelect}
              <label>{f("unit")}<select name="unit" defaultValue="MT">{units.map((u) => <option key={u.code} value={u.code}>{u.code}</option>)}</select></label>
            </div>
            <fieldset className="checks"><legend>{t("carrierSide")}</legend>
              <div className="grid2">
                <label>{t("carrierPrice")}<input name="carrierPrice" inputMode="decimal" dir="ltr" placeholder="70" /></label>
                <label>{t("basis")}<select name="carrierPriceBasis" defaultValue="per_unit"><option value="per_unit">{t("perUnit")}</option><option value="per_trip">{t("perTrip")}</option></select></label>
                <label>{t("reward")}<input name="rewardPerTrip" inputMode="decimal" dir="ltr" defaultValue="0" /></label>
                <label>{t("commission")}<input name="transporterCommission" inputMode="decimal" dir="ltr" defaultValue="0" /></label>
                <label>{t("allowance")}<input name="carrierAllowance" inputMode="decimal" dir="ltr" defaultValue="0.15" /></label>
                <label>{t("finePrice")}<input name="carrierFinePrice" inputMode="decimal" dir="ltr" defaultValue="1200" /></label>
                <label>{t("advanceNormal")}<input name="advanceNormal" inputMode="decimal" dir="ltr" /></label>
                <label>{t("advanceMax")} <span className="hint">{t("advanceMaxHint")}</span><input name="advanceMax" inputMode="decimal" dir="ltr" /></label>
              </div>
            </fieldset>
            {card.showProfit && (
              <fieldset className="checks"><legend>{t("customerSide")}</legend>
                <div className="grid2">
                  <label>{t("customerPrice")} <span className="hint">{t("customerPriceHint")}</span><input name="customerPrice" inputMode="decimal" dir="ltr" placeholder="120" /></label>
                  <label>{t("basis")}<select name="customerPriceBasis" defaultValue="per_unit"><option value="per_unit">{t("perUnit")}</option><option value="per_trip">{t("perTrip")}</option></select></label>
                  <label>{t("billedOn")}<select name="customerQtyBasis" defaultValue="net"><option value="net">{t("netQty")}</option><option value="loaded">{t("loadedQty")}</option></select></label>
                  <label>{t("customerAllowance")}<input name="customerAllowance" inputMode="decimal" dir="ltr" /></label>
                  <label>{t("allowanceBasis")}<select name="customerAllowanceBasis" defaultValue="per_trip"><option value="per_trip">{t("perTrip")}</option><option value="per_unit">{t("perLoadedUnit")}</option></select></label>
                  <label>{t("customerFinePrice")}<input name="customerFinePrice" inputMode="decimal" dir="ltr" /></label>
                </div>
              </fieldset>
            )}
            <fieldset className="checks"><legend>{t("demurrage")}</legend>
              <div className="grid2">
                <label>{t("method")}<select name="demurrageMethod" defaultValue="none"><option value="none">{t("dem_none")}</option><option value="arrival_to_discharge">{t("dem_arrival_to_discharge")}</option></select></label>
                <label>{t("freeDays")}<input name="demurrageFreeDays" inputMode="numeric" dir="ltr" defaultValue="0" /></label>
                <label>{t("carrierDemurrage")}<input name="carrierDemurrageRate" inputMode="decimal" dir="ltr" defaultValue="0" /></label>
                {card.showProfit && <label>{t("customerDemurrage")}<input name="customerDemurrageRate" inputMode="decimal" dir="ltr" defaultValue="0" /></label>}
              </div>
            </fieldset>
            <label>{t("note")} <span className="hint">{f("optional")}</span><input name="note" /></label>
          </ActionForm>
        </Modal>
      )}>
        {!latest.length ? <EmptyState icon="sliders" title={t("noTerms")} /> : (
          <div className="table-wrap"><table className="dense">
            <thead><tr>
              <th>{t("from")}</th><th>{t("route")}</th><th>{f("unit")}</th>
              <th className="num">{t("carrierPrice")}</th><th className="num">{t("reward")}</th><th className="num">{t("allowance")}</th><th className="num">{t("finePrice")}</th>
              {card.showProfit && <th className="num">{t("customerPrice")}</th>}
              <th>{t("demurrage")}</th><th className="num">{t("advanceNormal")}</th>
            </tr></thead>
            <tbody>{latest.map((v) => (
              <tr key={v.id}>
                <td className="ltr">{v.effectiveFrom}</td><td>{routeName(v.routeId)}</td><td className="ltr">{v.currency} / {v.unit}</td>
                <td className="num">{m(v.carrierPrice, v.currency)}{v.carrierPriceBasis === "per_trip" ? ` ${t("perTripShort")}` : ""}</td>
                <td className="num">{m(v.rewardPerTrip, v.currency)}</td>
                <td className="num">{formatQty(v.carrierAllowance, v.unit, locale)}</td>
                <td className="num">{m(v.carrierFinePrice, v.currency)}</td>
                {card.showProfit && <td className="num">{m(v.customerPrice, v.currency)}{v.customerPrice !== null && v.customerPriceBasis === "per_trip" ? ` ${t("perTripShort")}` : ""}</td>}
                <td>{v.demurrageMethod === "none" ? <span className="muted">—</span> : `${t("dem_arrival_to_discharge")} · ${v.demurrageFreeDays} ${t("daysFree")} · ${formatMoney(v.carrierDemurrageRate, v.currency, locale)}`}</td>
                <td className="num">{v.advanceNormal ? m(v.advanceNormal, v.currency) : <span className="muted">—</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>

      <div className="grid cols-2">
        <Card title={t("routes")} subtitle={t("routesHelp")} icon="map" flush actions={card.canManage && (
          <Modal label={t("addRoute")} icon={plus} small>
            <ActionForm command="job_routes.define" locale={locale} idempotencyKey={key()} submitLabel={f("save")}>
              <input type="hidden" name="jobId" value={jobId} />
              <label>{t("routeName")}<input name="name" required placeholder={t("routeExample")} /></label>
              <div className="grid2">
                <label>{t("loadingPlace")}<input name="loadingPlace" /></label>
                <label>{t("dischargePlace")}<input name="dischargePlace" /></label>
              </div>
            </ActionForm>
          </Modal>
        )}>
          {!card.routes.length ? <EmptyState icon="map" title={t("noRoutes")} /> : (
            <div className="table-wrap"><table className="dense">
              <thead><tr><th>{t("route")}</th><th>{t("loadingPlace")}</th><th>{t("dischargePlace")}</th></tr></thead>
              <tbody>{card.routes.map((r) => <tr key={r.id}><td><strong>{r.name}</strong></td><td>{r.loadingPlace ?? "—"}</td><td>{r.dischargePlace ?? "—"}</td></tr>)}</tbody>
            </table></div>
          )}
        </Card>

        <Card title={t("fees")} subtitle={t("feesHelp")} icon="receipt" flush actions={card.canManage && (<>
          <Modal label={t("setFee")} variant="primary" icon={plus} small>
            <ActionForm command="job_fees.set" locale={locale} idempotencyKey={key()} submitLabel={f("save")}>
              <input type="hidden" name="jobId" value={jobId} />
              <div className="grid2">
                <label>{t("fee")}<select name="feeTypeId" required>{card.allFeeTypes.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                <label>{t("from")}<input type="date" name="effectiveFrom" required defaultValue={today()} /></label>
                <label>{f("amount")} <span className="hint">{t("zeroEnds")}</span><input name="amount" required inputMode="decimal" dir="ltr" /></label>
                {currencySelect}
                <label>{t("basis")}<select name="basis" defaultValue="per_trip"><option value="per_trip">{t("perTrip")}</option><option value="per_loaded_unit">{t("perLoadedUnit")}</option><option value="per_net_unit">{t("perNetUnit")}</option></select></label>
                {routeOptions}
              </div>
              <label className="check"><input type="checkbox" name="deductFromCarrier" />{t("deductFromCarrier")}</label>
              {card.showProfit && <label className="check"><input type="checkbox" name="billedToCustomer" />{t("billedToCustomer")}</label>}
            </ActionForm>
          </Modal>
          <Modal label={t("newFeeType")} small>
            <ActionForm command="fee_types.define" locale={locale} idempotencyKey={key()} submitLabel={f("save")}>
              <p className="muted !m-0">{t("newFeeTypeHelp")}</p>
              <div className="grid2">
                <label>{f("name")}<input name="name" required /></label>
                <label>{t("basis")}<select name="defaultBasis" defaultValue="per_trip"><option value="per_trip">{t("perTrip")}</option><option value="per_loaded_unit">{t("perLoadedUnit")}</option><option value="per_net_unit">{t("perNetUnit")}</option></select></label>
                <label>{t("expenseAccount")}<select name="expenseAccountId" defaultValue=""><option value="">{f("choose")}</option>{expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></label>
              </div>
              <label className="check"><input type="checkbox" name="deductFromCarrier" />{t("deductFromCarrier")}</label>
              {card.showProfit && <label className="check"><input type="checkbox" name="billedToCustomer" />{t("billedToCustomer")}</label>}
            </ActionForm>
          </Modal>
        </>)}>
          {!card.fees.length ? <EmptyState icon="receipt" title={t("noFees")} /> : (
            <div className="table-wrap"><table className="dense">
              <thead><tr><th>{t("fee")}</th><th>{t("from")}</th><th>{t("route")}</th><th className="num">{f("amount")}</th><th>{t("basis")}</th><th></th></tr></thead>
              <tbody>{[...card.fees].reverse().map((x) => (
                <tr key={x.id}>
                  <td><strong>{feeName(x.feeTypeId)}</strong></td><td className="ltr">{x.effectiveFrom}</td><td>{routeName(x.routeId)}</td>
                  <td className="num">{formatMoney(x.amount, x.currency, locale)}</td>
                  <td>{x.basis === "per_trip" ? t("perTrip") : x.basis === "per_loaded_unit" ? t("perLoadedUnit") : t("perNetUnit")}</td>
                  <td className="chips">
                    {x.deductFromCarrier && <Badge tone="warning" plain>{t("deductedShort")}</Badge>}
                    {card.showProfit && x.billedToCustomer && <Badge tone="success" plain>{t("billedShort")}</Badge>}
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      </div>
    </div>
  );
}
