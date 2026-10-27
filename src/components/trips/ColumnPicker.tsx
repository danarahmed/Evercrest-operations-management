"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { usePopover } from "./popover";

type Saved = { mode: "auto" } | { mode: "manual"; hidden: string[] };

/**
 * Show/hide columns of a table, like a spreadsheet. Every th/td carries
 * data-col and the hidden keys are written to the table's data-hide
 * attribute (CSS does the hiding).
 *
 * By default the table fits the screen: lower-priority columns are hidden,
 * in the given order, until nothing overflows, and this is re-done when the
 * window changes size. Ticking a column switches to a manual choice that is
 * remembered per person in the browser; "Fit to screen" goes back to automatic.
 */
export function ColumnPicker({ tableId, storageKey, columns, autoHideOrder, label, fitLabel, hiddenLabel }: {
  tableId: string;
  storageKey: string;
  columns: { key: string; label: string }[];
  /** Columns to hide first when the table does not fit (least important first). */
  autoHideOrder: string[];
  label: string;
  fitLabel: string;
  /** Text with {count} for the number of columns hidden to fit. */
  hiddenLabel: string;
}) {
  const ref = usePopover();
  const [saved, setSaved] = useState<Saved>({ mode: "auto" });
  const [hidden, setHidden] = useState<string[]>([]);
  const loaded = useRef(false);

  const keys = columns.map((c) => c.key);
  const apply = useCallback((list: string[]) => {
    const valid = list.filter((k) => keys.includes(k));
    setHidden(valid);
    return valid;
  }, [keys.join(" ")]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Hide columns, least important first, until the table no longer overflows
   * its box. Measured with inline styles (synchronous), then handed to the
   * <style> element below so rows added later by a refresh follow the same rule.
   */
  const fit = useCallback(() => {
    const table = document.getElementById(tableId);
    const wrap = table?.parentElement;
    // Not in the page or not laid out yet (e.g. mid-refresh): measuring now would read zero and hide nothing.
    if (!table || !wrap || !table.isConnected || wrap.clientWidth === 0) return;
    const order = autoHideOrder.filter((k) => keys.includes(k));
    const cells = (k: string) => table.querySelectorAll<HTMLElement>(`[data-col="${k}"]`);
    for (const k of keys) cells(k).forEach((el) => (el.style.display = ""));
    const list: string[] = [];
    for (const k of order) {
      if (table.scrollWidth <= wrap.clientWidth) break;
      list.push(k);
      cells(k).forEach((el) => (el.style.display = "none"));
    }
    for (const k of list) cells(k).forEach((el) => (el.style.display = ""));
    apply(list);
  }, [tableId, autoHideOrder, apply]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let s: Saved = { mode: "auto" };
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) { const v = JSON.parse(raw); if (v?.mode === "manual" && Array.isArray(v.hidden)) s = { mode: "manual", hidden: v.hidden.filter((k: unknown) => typeof k === "string") }; }
    } catch { /* browser storage unavailable: automatic */ }
    loaded.current = true;
    setSaved(s);
  }, [storageKey]);

  useEffect(() => {
    if (!loaded.current) return;
    if (saved.mode === "manual") { apply(saved.hidden); return; }
    fit();
    // Measure again on the next frame (the page may still be settling after a refresh) and once web fonts are in.
    const raf = requestAnimationFrame(fit);
    document.fonts?.ready.then(fit);
    const table = document.getElementById(tableId);
    const wrap = table?.parentElement;
    if (!table || !wrap || typeof ResizeObserver === "undefined") return () => cancelAnimationFrame(raf);
    let last = wrap.clientWidth;
    const ro = new ResizeObserver(() => {
      if (wrap.clientWidth !== last || table.scrollWidth > wrap.clientWidth) { last = wrap.clientWidth; fit(); }
    });
    ro.observe(wrap);
    ro.observe(table);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [saved, apply, fit, tableId]);

  const store = (s: Saved) => {
    setSaved(s);
    try { window.localStorage.setItem(storageKey, JSON.stringify(s)); } catch { /* ignore */ }
  };
  const toggle = (key: string, show: boolean) => store({ mode: "manual", hidden: show ? hidden.filter((k) => k !== key) : [...hidden, key] });
  const n = hidden.length;

  const css = hidden.map((k) => `#${tableId} [data-col="${k.replace(/[^\w-]/g, "")}"]{display:none}`).join("");
  return (<>
    <style>{css}</style>
    <details className="colfilter colpicker pop-host" ref={ref}>
      <summary className={`btn ghost sm${n ? " on" : ""}`}><Icon name="sliders" size={14} />{label}{n > 0 && <b>{n}</b>}</summary>
      <div className="colfilter-pop pop">
        <label className="check colpicker-fit">
          <input type="checkbox" checked={saved.mode === "auto"} onChange={(e) => (e.target.checked ? store({ mode: "auto" }) : store({ mode: "manual", hidden }))} />
          <span>{fitLabel}{n > 0 && saved.mode === "auto" && <small className="muted"> · {hiddenLabel.replace("{count}", String(n))}</small>}</span>
        </label>
        <div className="colfilter-list">
          {columns.map((c) => (
            <label key={c.key} className="check">
              <input type="checkbox" checked={!hidden.includes(c.key)} onChange={(e) => toggle(c.key, e.target.checked)} />{c.label}
            </label>
          ))}
        </div>
      </div>
    </details>
  </>);
}
