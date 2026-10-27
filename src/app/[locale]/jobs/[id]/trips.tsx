import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Modal } from "@/components/Modal";
import { Icon } from "@/components/icons";
import { Badge, Card, EmptyState, Stat } from "@/components/ui";
import { formatMoney, formatQty } from "@/lib/format";
import type { jobTripsLive } from "@/server/queries";
import { ImportUpload } from "./import/ImportUpload";

type LiveView = Awaited<ReturnType<typeof jobTripsLive>>;

/**
 * The live trip grid (accounting method D): every trip calculated from the
 * rule card, estimated until discharged. The customer side and margins are
 * only present when the viewer may see profit.
 */
export async function TripsSection({ locale, jobId, view, actions, canImport }: { locale: string; jobId: string; view: LiveView; actions: ReactNode; canImport: boolean }) {
  const t = await getTranslations({ locale, namespace: "Trips" });
  const m = (a: string | null, c: string) => (a === null ? <span className="muted">—</span> : formatMoney(a, c, locale));
  const money = (a: string | null, c: string, sign = false) =>
    a === null ? <span className="muted">—</span> : <span className={sign && a.startsWith("-") ? "neg" : undefined}>{formatMoney(a, c, locale)}</span>;
  const { lines, totals, showProfit } = view;
  const unit = lines.find((l) => l.calc)?.calc?.unit ?? "MT";
  const q = (x: string | null) => (x === null ? <span className="muted">—</span> : formatQty(x, unit, locale));

  return (
    <div className="stack">
      {totals.map((s) => (
        <div key={s.currency} className="stats">
          <Stat icon="truck" label={t("tripsLoaded")} value={s.trips} hint={t("loadedTons", { qty: formatQty(s.loaded, unit, locale) })} />
          <Stat icon="clock" label={t("onTheWay")} value={s.onTheWay} tone={s.onTheWay ? "warning" : undefined} hint={t("estimatedHint")} />
          <Stat icon="checkCircle" label={t("dischargedCount")} value={s.discharged} tone="success" hint={t("netTons", { qty: formatQty(s.net, unit, locale) })} />
          <Stat icon="wallet" label={t("carriersToPay")} value={formatMoney(s.carrierToPay, s.currency, locale)} hint={t("advancesPaid", { amount: formatMoney(s.advances, s.currency, locale) })} />
          <Stat icon="receipt" label={t("feesAndCost")} value={formatMoney(s.cost, s.currency, locale)} hint={t("feesOnly", { amount: formatMoney(s.fees, s.currency, locale) })} />
          {showProfit && (
            <Stat icon="trendingUp" label={t("margin")} value={formatMoney(s.margin, s.currency, locale)} tone={s.margin.startsWith("-") ? "danger" : "success"}
              hint={s.priceTbd ? t("priceTbdCount", { count: s.priceTbd }) : t("billedTotal", { amount: formatMoney(s.customerTotal, s.currency, locale) })} />
          )}
        </div>
      ))}
      {view.withoutRules > 0 && <div className="banner"><Icon name="alert" /><div><div className="banner-label">{t("withoutRulesTitle", { count: view.withoutRules })}</div><div>{t("withoutRulesHelp")}</div></div></div>}

      <Card title={t("title")} icon="truck" flush actions={<>
        {canImport && (
          <Modal label={t("importSheet")} icon={<Icon name="upload" size={16} />} small>
            <ImportUpload locale={locale} jobId={jobId} idempotencyKey={crypto.randomUUID()} />
          </Modal>
        )}
        {actions}
      </>}>
        {lines.length === 0 ? <EmptyState icon="truck" title={t("noTrips")} hint={canImport ? t("noTripsHint") : undefined} /> : (
          <div className="table-wrap"><table className="dense">
            <thead><tr>
              <th>{t("manifest")}</th><th>{t("date")}</th><th>{t("route")}</th><th>{t("driver")}</th><th>{t("transporter")}</th><th>{t("plate")}</th>
              <th className="num">{t("loaded")}</th><th className="num">{t("discharged")}</th><th className="num">{t("net")}</th><th className="num">{t("fine")}</th>
              <th className="num">{t("carrierPay")}</th><th className="num">{t("advance")}</th><th className="num">{t("toPay")}</th><th className="num">{t("fees")}</th><th className="num">{t("cost")}</th>
              {showProfit && <><th className="num">{t("billed")}</th><th className="num">{t("margin")}</th></>}
              <th>{t("state")}</th>
            </tr></thead>
            <tbody>{lines.map((l) => {
              const c = l.calc;
              return (
                <tr key={l.id} className={l.status === "cancelled" ? "muted" : undefined}>
                  <td className="ltr"><strong>{l.manifestNo ?? l.tripNo}</strong></td>
                  <td className="ltr">{l.loadingDate ?? "—"}</td>
                  <td>{l.route ?? "—"}</td>
                  <td>{l.driver}</td>
                  <td>{l.transporter ?? <span className="muted">{t("direct")}</span>}</td>
                  <td className="ltr">{l.plate}</td>
                  <td className="num">{c ? q(c.loaded) : l.loadedQty ? formatQty(l.loadedQty, l.loadedUnit!, locale) : <span className="muted">—</span>}</td>
                  <td className="num">{c ? q(c.discharged) : l.dischargedQty ? formatQty(l.dischargedQty, l.dischargedUnit!, locale) : <span className="muted">—</span>}</td>
                  <td className="num">{c ? q(c.net) : <span className="muted">—</span>}</td>
                  <td className="num">{c ? money(c.carrier.fine === "0" ? null : c.carrier.fine, c.currency, true) : <span className="muted">—</span>}</td>
                  <td className="num">{c ? m(c.carrier.total, c.currency) : <span className="muted">—</span>}</td>
                  <td className="num">{Object.keys(l.advances).length ? Object.entries(l.advances).map(([cur, amt]) => <div key={cur}>{formatMoney(amt, cur, locale)}</div>) : <span className="muted">—</span>}</td>
                  <td className="num"><strong>{c ? money(c.carrier.toPay, c.currency, true) : <span className="muted">—</span>}</strong></td>
                  <td className="num">{c ? m(c.feesTotal === "0" ? null : c.feesTotal, c.currency) : <span className="muted">—</span>}</td>
                  <td className="num">{c ? m(c.cost, c.currency) : <span className="muted">—</span>}</td>
                  {showProfit && <><td className="num">{c ? m(c.customer.total, c.currency) : <span className="muted">—</span>}</td><td className="num">{c ? money(c.margin, c.currency, true) : <span className="muted">—</span>}</td></>}
                  <td>
                    {l.status === "cancelled" ? <Badge>{t("cancelled")}</Badge> : !c ? <Badge tone="danger">{t("noRule")}</Badge> : c.state === "confirmed" ? <Badge tone="success">{t("confirmed")}</Badge> : <Badge tone="warning">{t("estimated")}</Badge>}
                    {c?.flags.filter((x) => x !== "customer_price_tbd").map((x) => <div key={x} className="small warn">{t(`flag_${x}`)}</div>)}
                  </td>
                </tr>
              );
            })}</tbody>
            {totals.map((s) => (
              <tfoot key={s.currency}><tr className="net">
                <td colSpan={6}><strong>{t("total")} · {s.currency}</strong></td>
                <td className="num"><strong>{formatQty(s.loaded, unit, locale)}</strong></td><td></td><td className="num"><strong>{formatQty(s.net, unit, locale)}</strong></td><td></td>
                <td className="num"><strong>{formatMoney(s.carrierTotal, s.currency, locale)}</strong></td>
                <td className="num"><strong>{formatMoney(s.advances, s.currency, locale)}</strong></td>
                <td className="num"><strong>{formatMoney(s.carrierToPay, s.currency, locale)}</strong></td>
                <td className="num"><strong>{formatMoney(s.fees, s.currency, locale)}</strong></td>
                <td className="num"><strong>{formatMoney(s.cost, s.currency, locale)}</strong></td>
                {showProfit && <><td className="num"><strong>{formatMoney(s.customerTotal, s.currency, locale)}</strong></td><td className="num"><strong>{formatMoney(s.margin, s.currency, locale)}</strong></td></>}
                <td></td>
              </tr></tfoot>
            ))}
          </table></div>
        )}
      </Card>
    </div>
  );
}
