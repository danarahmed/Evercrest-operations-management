"use client";
import { useTranslations } from "next-intl";
import { type KeyboardEvent, useState } from "react";
import { Icon } from "../icons";

/**
 * Spreadsheet-style entry of many trips: one row per truck, Tab across the
 * cells, a new row appears at the end with the date, route, price, reward and
 * transporter copied from the row above. The rows are plain inputs named
 * r_<field>[] inside the surrounding ActionForm (trips.save_many), so one Save
 * stores them all after the same checks as a sheet import.
 */
export const GRID_FIELDS = ["loadingDate", "route", "carrierPrice", "reward", "advance", "transporter", "driver", "plate", "manifest", "loadedQty", "dischargeDate", "dischargedQty"] as const;
export type GridField = (typeof GRID_FIELDS)[number];
const COPY_DOWN: GridField[] = ["loadingDate", "route", "carrierPrice", "reward", "advance", "transporter"];
const NUMERIC: GridField[] = ["carrierPrice", "reward", "advance", "loadedQty", "dischargedQty"];
const DATES: GridField[] = ["loadingDate", "dischargeDate"];

type Row = Record<GridField, string>;
const empty = (): Row => Object.fromEntries(GRID_FIELDS.map((f) => [f, ""])) as Row;

export function TripGrid({ defaults, lists }: { defaults: Partial<Row>; lists: { routes: string[]; transporters: string[]; drivers: string[] } }) {
  const t = useTranslations("Trips");
  const [rows, setRows] = useState<Row[]>([{ ...empty(), ...defaults }]);
  const set = (i: number, f: GridField, v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [f]: v } : r)));
  const addRow = () =>
    setRows((rs) => {
      const last = rs[rs.length - 1];
      const next = empty();
      for (const f of COPY_DOWN) next[f] = last[f];
      return [...rs, next];
    });
  const remove = (i: number) => setRows((rs) => (rs.length === 1 ? [{ ...empty(), ...defaults }] : rs.filter((_, j) => j !== i)));
  const onKey = (e: KeyboardEvent<HTMLInputElement>, i: number, f: GridField) => {
    // Tab out of the last cell of the last row: a new row, ready to type.
    if (e.key === "Tab" && !e.shiftKey && i === rows.length - 1 && f === GRID_FIELDS[GRID_FIELDS.length - 1]) {
      e.preventDefault();
      addRow();
      setTimeout(() => document.querySelector<HTMLInputElement>(`[data-cell="${i + 1}:driver"]`)?.focus(), 0);
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const next = document.querySelector<HTMLInputElement>(`[data-cell="${i + 1}:${f}"]`);
      if (next) next.focus();
      else addRow();
    }
  };
  const list = (f: GridField) => (f === "route" ? "grid-routes" : f === "transporter" ? "grid-transporters" : f === "driver" ? "grid-drivers" : undefined);
  const filled = rows.filter((r) => r.manifest || r.driver || r.loadedQty).length;
  return (
    <div className="grid-entry">
      <datalist id="grid-routes">{lists.routes.map((x) => <option key={x} value={x} />)}</datalist>
      <datalist id="grid-transporters">{lists.transporters.map((x) => <option key={x} value={x} />)}</datalist>
      <datalist id="grid-drivers">{lists.drivers.map((x) => <option key={x} value={x} />)}</datalist>
      <div className="table-wrap"><table className="dense entry">
        <thead><tr><th>#</th>{GRID_FIELDS.map((f) => <th key={f} className={NUMERIC.includes(f) ? "num" : undefined}>{t(`col_${f}`)}</th>)}<th></th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="muted ltr">{i + 1}</td>
              {GRID_FIELDS.map((f) => (
                <td key={f}>
                  <input
                    name={`r_${f}[]`}
                    value={r[f]}
                    onChange={(e) => set(i, f, e.target.value)}
                    onKeyDown={(e) => onKey(e, i, f)}
                    data-cell={`${i}:${f}`}
                    type={DATES.includes(f) ? "date" : "text"}
                    inputMode={NUMERIC.includes(f) ? "decimal" : undefined}
                    dir={NUMERIC.includes(f) || DATES.includes(f) || f === "plate" || f === "manifest" ? "ltr" : undefined}
                    list={list(f)}
                    autoComplete="off"
                    aria-label={t(`col_${f}`)}
                  />
                </td>
              ))}
              <td><button type="button" className="ghost icon-btn sm" aria-label={t("removeRow")} onClick={() => remove(i)}><Icon name="x" size={14} /></button></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <div className="row" style={{ justifyContent: "space-between", marginBlockStart: 8 }}>
        <button type="button" className="sm" onClick={addRow}><Icon name="plus" size={14} />{t("addRow")}</button>
        <span className="small muted">{t("rowsReady", { count: filled })} · {t("gridHint")}</span>
      </div>
    </div>
  );
}
