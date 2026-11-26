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
  /** Kept for the page's call; fee types are set up in Setup now. */
  expenseAccounts?: { id: string; code: string; name: string }[];
}) {
  const t = await getTranslations({ locale, namespace: "Rules" });
  const f = await getTranslations({ locale, namespace: "Forms" });
  const m = (a: string | null, c: string) => (a === null ? <span className="muted">{t("tbd")}</span> : formatMoney(a, c, locale));
  const routeName = (id: string | null) => (id ? (card.routes.find((r) => r.id === id)?.name ?? "?") : t("allRoutes"));
  const feeName = (id: string) => card.allFeeTypes.find((x) => x.id === id)?.name ?? "?";
  const plus = <Icon name="plus" size={16} />;
  const latest = [...card.terms].reverse();
  const job = latest.find((v) => v.routeId === null) ?? latest[0];
  const unit = job?.unit ?? "MT";
  const cur = job?.currency ?? "USD";
  // Route lines, newest first per route; the first one of each route is the price in force today.
  const byRoute = card.routes.map((r) => ({ route: r, lines: card.routePrices.filter((p) => p.routeId === r.id).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)) }));
  const nowIso = today();
  // Fees on the customer's invoice, from a date (newest first); before any line, each kind's own setting.
  const billedVersions = [...card.billedFees].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  const inForce = billedVersions.find((v) => v.effectiveFrom <= nowIso) ?? null;
  const activeKinds = card.allFeeTypes.filter((k) => k.active);
  const billedNow = new Set(inForce ? inForce.feeTypeIds : activeKinds.filter((k) => k.billedToCustomer && k.paidBy !== "customer").map((k) => k.id));
  const currencySelect = (
    <label>{f("currency")}<select name="currency" defaultValue="USD"><option value="USD">USD</option><option value="IQD">IQD</option></select></label>
  );

  return (
    <div className="stack">
      {!card.terms.length && <div className="banner"><Icon name="info" /><div><div className="banner-label">{t("noRulesTitle")}</div><div>{t("noRulesHelp")}</div></div></div>}

      <Card title={t("routePrices")} subtitle={t("routePricesHelp")} icon="map" flush actions={card.canManage && (
        <Modal label={t("setRoutePrice")} variant="primary" icon={plus} small>
          <p className="muted">{t("setRoutePriceHelp")}</p>
          <ActionForm command="route_prices.set" locale={locale} idempotencyKey={key()} submitLabel={f("save")}>
            <input type="hidden" name="jobId" value={jobId} />
            <div className="grid2">
              <label>{t("route")}<select name="routeId" defaultValue={card.routes[0]?.id ?? ""}><option value="">{t("newRoute")}</option>{card.routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
              <label>{t("newRouteName")} <span className="hint">{t("newRouteNameHint")}</span><input name="routeName" placeholder={t("routeExample")} /></label>
              <label>{t("from")}<input type="date" name="effectiveFrom" required defaultValue={nowIso} /></label>
              <label>{t("carrierPrice")} <span className="hint">{cur} / {unit}</span><input name="carrierPrice" required inputMode="decimal" dir="ltr" placeholder="70" /></label>
              <label>{t("reward")} <span className="hint">{t("emptyJobWide")}</span><input name="rewardPerTrip" inputMode="decimal" dir="ltr" /></label>
              <label>{t("allowance")} <span className="hint">{t("emptyJobWide")}</span><input name="carrierAllowance" inputMode="decimal" dir="ltr" /></label>
            </div>
            <label>{t("note")} <span className="hint">{f("optional")}</span><input name="note" /></label>
          </ActionForm>
        </Modal>
      )}>
        {!byRoute.length ? <EmptyState icon="map" title={t("noRoutes")} hint={t("noRoutesHint")} /> : (
          <div className="table-wrap"><table className="dense">
            <thead><tr><th>{t("route")}</th><th>{t("from")}</th><th className="num">{t("carrierPrice")} ({cur}/{unit})</th><th className="num">{t("reward")}</th><th className="num">{t("allowance")}</th><th>{t("note")}</th></tr></thead>
            <tbody>{byRoute.flatMap(({ route, lines }) => {
              if (!lines.length) return [<tr key={route.id}><td><strong>{route.name}</strong></td><td colSpan={5} className="muted">{t("usesJobWide")}</td></tr>];
              const current = lines.find((l) => l.effectiveFrom <= nowIso) ?? lines[lines.length - 1];
              return lines.map((l, i) => (
                <tr key={l.id} className={l === current || l.effectiveFrom > nowIso ? "" : "muted"}>
                  <td>{i === 0 ? <strong>{route.name}</strong> : null}</td>
                  <td className="ltr">{l.effectiveFrom}{l.effectiveFrom > nowIso ? <> <Badge tone="info">{t("upcoming")}</Badge></> : l === current ? <> <Badge tone="success">{t("inForce")}</Badge></> : null}</td>
                  <td className="num">{formatMoney(l.carrierPrice, cur, locale)}</td>
                  <td className="num">{l.rewardPerTrip !== null ? formatMoney(l.rewardPerTrip, cur, locale) : <span className="muted">{t("jobWide")}</span>}</td>
                  <td className="num">{l.carrierAllowance !== null ? formatQty(l.carrierAllowance, unit, locale) : <span className="muted">{t("jobWide")}</span>}</td>
                  <td className="wrap muted">{l.note ?? ""}</td>
                </tr>
              ));
            })}</tbody>
          </table></div>
        )}
      </Card>

      <Card title={t("terms")} subtitle={t("termsHelp")} icon="sliders" flush actions={card.canManage && (
        <Modal label={t("newVersion")} variant={card.terms.length ? "secondary" : "primary"} icon={plus} size="lg">
          <ActionForm command="job_terms.set" locale={locale} idempotencyKey={key()} submitLabel={f("save")}>
            <input type="hidden" name="jobId" value={jobId} />
            <div className="grid2">
              <label>{t("from")}<input type="date" name="effectiveFrom" required defaultValue={today()} /></label>
              {currencySelect}
              <label>{f("unit")}<select name="unit" defaultValue="MT">{units.map((u) => <option key={u.code} value={u.code}>{u.code}</option>)}</select></label>
            </div>
            <fieldset className="checks"><legend>{t("carrierSide")}</legend>
              <div className="grid2">
                <label>{t("carrierPrice")} <span className="hint">{t("jobWidePriceHint")}</span><input name="carrierPrice" inputMode="decimal" dir="ltr" placeholder="70" /></label>
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
              <th>{t("from")}</th><th>{f("unit")}</th>
              <th className="num">{t("carrierPrice")}</th><th className="num">{t("reward")}</th><th className="num">{t("allowance")}</th><th className="num">{t("finePrice")}</th>
              {card.showProfit && <th className="num">{t("customerPrice")}</th>}
              <th>{t("demurrage")}</th><th className="num">{t("advanceMax")}</th>
            </tr></thead>
            <tbody>{latest.map((v) => (
              <tr key={v.id}>
                <td className="ltr">{v.effectiveFrom}{v.routeId ? <div className="cell-sub">{routeName(v.routeId)}</div> : null}</td><td className="ltr">{v.currency} / {v.unit}</td>
                <td className="num">{m(v.carrierPrice, v.currency)}{v.carrierPriceBasis === "per_trip" ? ` ${t("perTripShort")}` : ""}</td>
                <td className="num">{m(v.rewardPerTrip, v.currency)}</td>
                <td className="num">{formatQty(v.carrierAllowance, v.unit, locale)}</td>
                <td className="num">{m(v.carrierFinePrice, v.currency)}</td>
                {card.showProfit && <td className="num">{m(v.customerPrice, v.currency)}{v.customerPrice !== null && v.customerPriceBasis === "per_trip" ? ` ${t("perTripShort")}` : ""}</td>}
                <td>{v.demurrageMethod === "none" ? <span className="muted">—</span> : `${t("dem_arrival_to_discharge")} · ${v.demurrageFreeDays} ${t("daysFree")} · ${formatMoney(v.carrierDemurrageRate, v.currency, locale)}`}</td>
                <td className="num">{v.advanceMax ? m(v.advanceMax, v.currency) : <span className="muted">—</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>

      <Card title={t("billedTitle")} subtitle={t("billedHelp")} icon="receipt" flush actions={card.canManage && (
        <Modal label={t("billedChange")} icon={plus} small>
          <ActionForm command="job_billed_fees.set" locale={locale} idempotencyKey={key()} submitLabel={f("save")}>
            <input type="hidden" name="jobId" value={jobId} />
            <p className="muted small">{t("billedChangeHelp")}</p>
            <label>{t("from")}<input type="date" name="effectiveFrom" required defaultValue={nowIso} /></label>
            <fieldset className="checks"><legend>{t("billedKinds")}</legend>
              {activeKinds.map((ft) => <label key={ft.id} className="check"><input type="checkbox" name="feeTypeIds[]" value={ft.id} defaultChecked={billedNow.has(ft.id)} />{ft.name}</label>)}
            </fieldset>
            <label>{t("note")} <span className="hint">{f("optional")}</span><input name="note" /></label>
          </ActionForm>
        </Modal>
      )}>
        {!billedVersions.length ? (
          <div className="card-body"><p className="muted !m-0">{billedNow.size ? t("billedDefault", { kinds: activeKinds.filter((k) => billedNow.has(k.id)).map((k) => k.name).join(", ") }) : t("billedNone")}</p></div>
        ) : (
          <div className="table-wrap"><table className="dense">
            <thead><tr><th>{t("from")}</th><th>{t("billedKinds")}</th><th>{t("note")}</th></tr></thead>
            <tbody>{billedVersions.map((v) => (
              <tr key={v.id} className={v === inForce || v.effectiveFrom > nowIso ? "" : "muted"}>
                <td className="ltr">{v.effectiveFrom}{v.effectiveFrom > nowIso ? <> <Badge tone="info">{t("upcoming")}</Badge></> : v === inForce ? <> <Badge tone="success">{t("inForce")}</Badge></> : null}</td>
                <td className="wrap">{v.feeTypeIds.length ? v.feeTypeIds.map((id) => feeName(id)).join(", ") : <span className="muted">{t("billedNoneShort")}</span>}</td>
                <td className="wrap muted">{v.note ?? ""}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>

      <div className="alert info flex items-start gap-3"><Icon name="info" size={18} /><div>{t("feesMoved")}</div></div>
    </div>
  );
}
