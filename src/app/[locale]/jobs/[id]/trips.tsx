import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { ActionForm } from "@/components/ActionForm";
import { ExportButton } from "@/components/ExportButton";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/Modal";
import { ColumnHeader } from "@/components/trips/ColumnFilter";
import { ColumnPicker } from "@/components/trips/ColumnPicker";
import { EntryLine } from "@/components/trips/EntryLine";
import { TripGrid } from "@/components/trips/TripGrid";
import { Badge, Card, EmptyState, Stat } from "@/components/ui";
import { TRIP_CHIPS, type TripFilters, type TripSort } from "@/domain/transport/trip-view";
import { formatMoney, formatNumber, formatQty } from "@/lib/format";
import { activeFilterCount, filterParams } from "@/lib/trip-filters";
import type { jobTripsLive } from "@/server/queries";
import { ImportUpload } from "./import/ImportUpload";

type LiveView = Awaited<ReturnType<typeof jobTripsLive>>;

/**
 * The live trip grid (accounting method D) with spreadsheet-like filters:
 * sort by any column, tick values from a column's funnel, search, date ranges
 * and quick chips; all in the URL, totals follow the filtered rows. Clicking
 * a manifest opens the trip's one-screen dialog. Below, staff enter many trips
 * at once in the entry grid.
 */
export async function TripsSection({ locale, basePath, baseParams, view, filters, actions, canImport, showJob, jobId, moneyAccounts, advancesEnabled }: {
  locale: string;
  basePath: string;
  baseParams: Record<string, string>;
  view: LiveView;
  filters: TripFilters;
  actions?: ReactNode;
  canImport: boolean;
  showJob: boolean;
  jobId: string | null;
  moneyAccounts: { id: string; name: string; currency: string }[];
  advancesEnabled: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "Trips" });
  const f = await getTranslations({ locale, namespace: "Forms" });
  const m = (a: string | null, c: string) => (a === null ? <span className="muted">—</span> : formatMoney(a, c, locale));
  const money = (a: string | null, c: string, sign = false) =>
    a === null ? <span className="muted">—</span> : <span className={sign && a.startsWith("-") ? "neg" : undefined}>{formatMoney(a, c, locale)}</span>;
  const { lines, totals, feeTypes, showProfit, options, total, page, pageSize } = view;
  const feeKey = (id: string) => `fee-${id.replace(/[^\w-]/g, "")}`;
  const unit = lines.find((l) => l.calc)?.calc?.unit ?? "MT";
  const q = (x: string | null) => (x === null ? <span className="muted">—</span> : formatNumber(x, locale));
  const tableId = showJob ? "trips-all" : "trips-job";
  const pickable = [
    ...(showJob ? [{ key: "job", label: t("job") }] : []),
    { key: "date", label: t("date") }, { key: "route", label: t("route") }, { key: "driver", label: t("driver") }, { key: "transporter", label: t("transporter") }, { key: "plate", label: t("plate") },
    { key: "loaded", label: t("loaded") }, { key: "discharged", label: t("discharged") }, { key: "net", label: t("net") }, { key: "fine", label: t("fine") }, { key: "carrierPay", label: t("carrierPay") },
    { key: "advance", label: t("advance") }, { key: "toPay", label: t("toPay") }, ...feeTypes.map((ft) => ({ key: feeKey(ft.id), label: ft.name })), { key: "cost", label: t("cost") },
    ...(showProfit ? [{ key: "billed", label: t("billed") }, { key: "margin", label: t("margin") }] : []), { key: "state", label: t("state") },
  ];
  const href = (over: Partial<TripFilters>, extra: Record<string, string | undefined> = {}) => `${basePath}?${filterParams({ ...filters, page: 1, ...over }, { ...baseParams, ...extra })}`;
  const active = activeFilterCount(filters);
  const current = filters.sort ?? "loadingDate";
  const dir = filters.dir ?? (filters.sort ? "asc" : "desc");
  // Each header gets a ready-made link (client components cannot receive functions).
  const hdr = (sortKey: TripSort) => ({ sortKey, current, dir, sortHref: href({ sort: sortKey, dir: current === sortKey && dir === "asc" ? "desc" : "asc" }), applyLabel: t("apply"), clearLabel: t("clear"), searchLabel: t("filterBy") });
  const stateOpts = (["estimated", "confirmed", "norule", "cancelled"] as const).map((s) => ({ value: s, label: t(s === "norule" ? "noRule" : s) }));
  const last = lines[0];
  const gridDefaults = { loadingDate: new Date().toISOString().slice(0, 10), route: last?.route ?? "", transporter: last?.transporter ?? "", carrierPrice: last?.calc?.carrier.price ? String(Number(last.calc.carrier.price)) : "" };
  const pages = Math.max(Math.ceil(total / pageSize), 1);

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

      <Card title={active ? t("titleFiltered", { shown: total }) : t("title")} icon="truck" flush actions={<>
        <ExportButton label={f("export")} filename="evercrest-trips" />
        {canImport && jobId && (
          <Modal label={t("importSheet")} icon={<Icon name="upload" size={16} />} small>
            <ImportUpload locale={locale} jobId={jobId} idempotencyKey={crypto.randomUUID()} />
          </Modal>
        )}
        {actions}
      </>}>
        {view.canEdit && jobId && (
          <EntryLine locale={locale} jobId={jobId} lists={{ routes: options.routes.map((r) => r.name), transporters: options.transporters.map((r) => r.name), drivers: options.drivers.map((d) => ({ name: d.name, plate: d.plate })) }}
            moneyAccounts={moneyAccounts} advancesEnabled={advancesEnabled} defaults={{ loadingDate: gridDefaults.loadingDate, route: gridDefaults.route, transporter: gridDefaults.transporter }} />
        )}
        <form method="get" className="trip-filter-form">
          {Object.entries(baseParams).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          {filters.sort && <input type="hidden" name="sort" value={filters.sort} />}
          {filters.dir && <input type="hidden" name="dir" value={filters.dir} />}
          <div className="filters" style={{ margin: 0, borderRadius: 0, borderInline: 0, borderTop: 0, boxShadow: "none" }}>
            <label>{t("search")}<input name="q" defaultValue={filters.q ?? ""} placeholder={t("searchHint")} /></label>
            <label>{t("loadedFrom")}<input type="date" name="lf" defaultValue={filters.loadedFrom ?? ""} /></label>
            <label>{t("to")}<input type="date" name="lt" defaultValue={filters.loadedTo ?? ""} /></label>
            <label>{t("dischargedFrom")}<input type="date" name="df" defaultValue={filters.dischargedFrom ?? ""} /></label>
            <label>{t("to")}<input type="date" name="dt" defaultValue={filters.dischargedTo ?? ""} /></label>
            <div className="chips-filter">
              {TRIP_CHIPS.filter((c) => showProfit || c !== "pricetbd").map((c) => (
                <label key={c} className="chip-toggle"><input type="checkbox" name="chip" value={c} defaultChecked={filters.chips?.includes(c)} /><span className="chip">{t(`chip_${c}`)}</span></label>
              ))}
            </div>
            <button type="submit"><Icon name="search" size={16} />{t("show")}</button>
            {active > 0 && <Link href={`${basePath}?${new URLSearchParams(baseParams)}`} className="btn ghost">{t("clearAll", { count: active })}</Link>}
            <ColumnPicker tableId={tableId} storageKey={`${tableId}.columns`} columns={pickable} autoHideOrder={["cost", "billed", "discharged", "plate", "route", ...feeTypes.map((ft) => feeKey(ft.id)), "fine", "date", "advance", "state", "margin", "transporter"]} label={t("columns")} fitLabel={t("fitToScreen")} hiddenLabel={t("hiddenColumns", { count: "{count}" })} />
          </div>
          {lines.length === 0 ? <EmptyState icon="truck" title={active ? t("noMatch") : t("noTrips")} hint={!active && canImport ? t("noTripsHint") : undefined} /> : (
            <div className="table-wrap"><table className="dense trips" id={tableId}>
              <thead><tr>
                {showJob && <ColumnHeader label={t("job")} col="job" {...hdr("job")} filter={{ name: "job", options: options.jobs.map((j) => ({ value: j.id, label: `${j.no} · ${j.name}` })), selected: filters.jobIds ?? [] }} />}
                <ColumnHeader label={t("manifest")} {...hdr("manifest")} />
                <ColumnHeader label={t("date")} col="date" {...hdr("loadingDate")} />
                <ColumnHeader label={t("route")} col="route" {...hdr("route")} filter={{ name: "route", options: options.routes.map((r) => ({ value: r.id, label: r.name })), selected: filters.routeIds ?? [] }} />
                <ColumnHeader label={t("driver")} col="driver" {...hdr("driver")} filter={{ name: "dr", options: options.drivers.map((r) => ({ value: r.id, label: r.name })), selected: filters.driverIds ?? [] }} />
                <ColumnHeader label={t("transporter")} col="transporter" {...hdr("transporter")} filter={{ name: "tr", options: [{ value: "direct", label: t("direct") }, ...options.transporters.map((r) => ({ value: r.id, label: r.name }))], selected: [...(filters.transporterIds ?? []), ...(filters.direct ? ["direct"] : [])] }} />
                <ColumnHeader label={t("plate")} col="plate" {...hdr("plate")} />
                <ColumnHeader label={`${t("loaded")} (${unit})`} col="loaded" align="num" {...hdr("loaded")} />
                <ColumnHeader label={`${t("discharged")} (${unit})`} col="discharged" align="num" {...hdr("discharged")} />
                <ColumnHeader label={`${t("net")} (${unit})`} col="net" align="num" {...hdr("net")} />
                <ColumnHeader label={t("fine")} col="fine" align="num" {...hdr("fine")} />
                <ColumnHeader label={t("carrierPay")} col="carrierPay" align="num" {...hdr("carrierPay")} />
                <ColumnHeader label={t("advance")} col="advance" align="num" {...hdr("advance")} />
                <ColumnHeader label={t("toPay")} col="toPay" align="num" {...hdr("toPay")} />
                {feeTypes.map((ft) => <ColumnHeader key={ft.id} label={ft.name} col={feeKey(ft.id)} align="num" applyLabel={t("apply")} clearLabel={t("clear")} searchLabel={t("filterBy")} />)}
                <ColumnHeader label={t("cost")} col="cost" align="num" {...hdr("cost")} />
                {showProfit && <><ColumnHeader label={t("billed")} col="billed" align="num" {...hdr("billed")} /><ColumnHeader label={t("margin")} col="margin" align="num" {...hdr("margin")} /></>}
                <ColumnHeader label={t("state")} col="state" {...hdr("state")} filter={{ name: "st", options: stateOpts, selected: filters.states ?? [] }} />
              </tr></thead>
              <tbody>{lines.map((l) => {
                const c = l.calc;
                const open = href({}, { page: page > 1 ? String(page) : undefined, trip: l.id });
                return (
                  <tr key={l.id} className={l.status === "cancelled" ? "muted" : undefined}>
                    {showJob && <td className="wrap" data-col="job"><Link href={`/${locale}/jobs/${l.jobId}?tab=trips`}>{l.jobNo}</Link><div className="cell-sub">{l.jobName}</div></td>}
                    <td className="ltr"><Link href={open} className="cell-title">{l.manifestNo ?? l.tripNo}</Link></td>
                    <td className="ltr" data-col="date">{l.loadingDate ?? "—"}</td>
                    <td className="clip" data-col="route" title={l.route ?? undefined}>{l.route ?? "—"}</td>
                    <td className="clip" data-col="driver" title={l.driver}>{l.driver}</td>
                    <td className="clip" data-col="transporter" title={l.transporter ?? undefined}>{l.transporter ?? <span className="muted">{t("direct")}</span>}</td>
                    <td className="ltr clip" data-col="plate" title={l.plate}>{l.plate}</td>
                    <td className="num" data-col="loaded">{c ? q(c.loaded) : l.loadedQty ? q(l.loadedQty) : <span className="muted">—</span>}</td>
                    <td className="num" data-col="discharged">{c ? q(c.discharged) : l.dischargedQty ? q(l.dischargedQty) : <span className="muted">—</span>}</td>
                    <td className="num" data-col="net">{c ? q(c.net) : <span className="muted">—</span>}</td>
                    <td className="num" data-col="fine">{c ? money(c.carrier.fine === "0" ? null : c.carrier.fine, c.currency, true) : <span className="muted">—</span>}</td>
                    <td className="num" data-col="carrierPay">{c ? m(c.carrier.total, c.currency) : <span className="muted">—</span>}</td>
                    <td className="num" data-col="advance">{Object.keys(l.advances).length ? Object.entries(l.advances).map(([cur, amt]) => <div key={cur}>{formatMoney(amt, cur, locale)}</div>) : <span className="muted">—</span>}</td>
                    <td className="num" data-col="toPay"><strong>{c ? money(c.carrier.toPay, c.currency, true) : <span className="muted">—</span>}</strong></td>
                    {feeTypes.map((ft) => { const fee = c?.fees.find((x) => x.feeTypeId === ft.id); return <td key={ft.id} className="num" data-col={feeKey(ft.id)}>{fee && fee.amount !== "0" ? formatMoney(fee.amount, fee.currency, locale) : <span className="muted">—</span>}</td>; })}
                    <td className="num" data-col="cost">{c ? m(c.cost, c.currency) : <span className="muted">—</span>}</td>
                    {showProfit && <><td className="num" data-col="billed">{c ? m(c.customer.total, c.currency) : <span className="muted">—</span>}</td><td className="num" data-col="margin">{c ? money(c.margin, c.currency, true) : <span className="muted">—</span>}</td></>}
                    <td data-col="state">
                      {l.state === "cancelled" ? <Badge>{t("cancelled")}</Badge> : l.state === "norule" ? <Badge tone="danger">{t("noRule")}</Badge> : l.state === "confirmed" ? <Badge tone="success">{t("confirmed")}</Badge> : <Badge tone="warning">{t("estimated")}</Badge>}
                      {c?.flags.filter((x) => x !== "customer_price_tbd").map((x) => <div key={x} className="small warn">{t(`flag_${x}`)}</div>)}
                    </td>
                  </tr>
                );
              })}</tbody>
              {totals.map((s) => (
                <tfoot key={s.currency}><tr className="net">
                  {showJob && <td data-col="job"></td>}
                  <td><strong>{t("total")} · {s.currency}{active ? ` · ${t("filteredRows", { count: s.trips })}` : ""}</strong></td>
                  <td data-col="date"></td><td data-col="route"></td><td data-col="driver"></td><td data-col="transporter"></td><td data-col="plate"></td>
                  <td className="num" data-col="loaded"><strong>{q(s.loaded)}</strong></td><td data-col="discharged"></td><td className="num" data-col="net"><strong>{q(s.net)}</strong></td><td data-col="fine"></td>
                  <td className="num" data-col="carrierPay"><strong>{formatMoney(s.carrierTotal, s.currency, locale)}</strong></td>
                  <td className="num" data-col="advance"><strong>{formatMoney(s.advances, s.currency, locale)}</strong></td>
                  <td className="num" data-col="toPay"><strong>{formatMoney(s.carrierToPay, s.currency, locale)}</strong></td>
                  {feeTypes.map((ft) => <td key={ft.id} className="num" data-col={feeKey(ft.id)}><strong>{formatMoney(s.feeByType[ft.id] ?? "0", s.currency, locale)}</strong></td>)}
                  <td className="num" data-col="cost"><strong>{formatMoney(s.cost, s.currency, locale)}</strong></td>
                  {showProfit && <><td className="num" data-col="billed"><strong>{formatMoney(s.customerTotal, s.currency, locale)}</strong></td><td className="num" data-col="margin"><strong>{formatMoney(s.margin, s.currency, locale)}</strong></td></>}
                  <td data-col="state"></td>
                </tr></tfoot>
              ))}
            </table></div>
          )}
        </form>
        {pages > 1 && (
          <div className="pager">
            <span>{t("pageOf", { page, pages, total })}</span>
            <span className="row">
              {page > 1 && <Link href={href({ page: page - 1 }, { page: String(page - 1) })} className="btn ghost sm"><Icon name="chevronLeft" size={14} />{t("prev")}</Link>}
              {page < pages && <Link href={href({ page: page + 1 }, { page: String(page + 1) })} className="btn ghost sm">{t("next")}<Icon name="chevronRight" size={14} /></Link>}
            </span>
          </div>
        )}
      </Card>

      {view.canEdit && jobId && (
        <details className="card">
          <summary className="card-head" style={{ cursor: "pointer" }}><div className="card-title"><Icon name="plus" />{t("enterManyRows")}<span className="muted small" style={{ fontWeight: 500 }}> · {t("enterTripsHelp")}</span></div></summary>
          <div className="card-body">
            <ActionForm command="trips.save_many" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("saveRows")} redirectTo={`${basePath}?${new URLSearchParams(baseParams)}`}>
              <input type="hidden" name="jobId" value={jobId} />
              <TripGrid defaults={gridDefaults} lists={{ routes: options.routes.map((r) => r.name), transporters: options.transporters.map((r) => r.name), drivers: options.drivers.map((r) => r.name) }} />
              {advancesEnabled && (
                <label style={{ maxWidth: 360 }}>{t("advancesPaidFrom")} <span className="hint">{t("advancesPaidFromHint")}</span>
                  <select name="moneyAccountId" defaultValue=""><option value="">{t("noAdvances")}</option>{moneyAccounts.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.currency})</option>)}</select>
                </label>
              )}
            </ActionForm>
          </div>
        </details>
      )}
    </div>
  );
}
