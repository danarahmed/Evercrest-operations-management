"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "../icons";
import { usePopover } from "./popover";

/**
 * A column header that works like a spreadsheet's: click the title to sort,
 * open the funnel to tick the values to show. Checkboxes live inside the
 * page's GET form, so the filter stays in the URL; the panel floats above the
 * table so the table's own scrolling never clips it.
 */
export function ColumnHeader({ label, col, sortKey, current, dir, sortHref, align, filter, applyLabel, clearLabel, searchLabel }: {
  label: ReactNode;
  /** Column key for show/hide (see ColumnPicker). */
  col?: string;
  sortKey?: string;
  current?: string;
  dir?: "asc" | "desc";
  /** Link that sorts by this column (toggling the direction when it is already the sort key). */
  sortHref?: string;
  align?: "num";
  filter?: { name: string; options: { value: string; label: string }[]; selected: string[] };
  applyLabel: string;
  clearLabel: string;
  searchLabel: string;
}) {
  const ref = usePopover();
  const active = sortKey && current === sortKey;
  const title = sortKey && sortHref ? (
    <Link href={sortHref} className={`th-sort${active ? " on" : ""}`}>{label}{active && <Icon name={dir === "asc" ? "chevronUp" : "chevronDown"} size={12} />}</Link>
  ) : label;
  const n = filter?.selected.length ?? 0;
  return (
    <th className={align} data-col={col}>
      <span className="th-wrap">
        {title}
        {filter && filter.options.length > 0 && (
          <details className="colfilter pop-host" ref={ref}>
            <summary aria-label={`${searchLabel}: ${typeof label === "string" ? label : ""}`} className={n ? "on" : undefined}><Icon name="filter" size={12} />{n > 0 && <b>{n}</b>}</summary>
            <div className="colfilter-pop pop">
              <div className="colfilter-list">
                {filter.options.map((o) => (
                  <label key={o.value} className="check"><input type="checkbox" name={filter.name} value={o.value} defaultChecked={filter.selected.includes(o.value)} />{o.label}</label>
                ))}
              </div>
              <div className="row">
                <button type="submit" className="primary sm">{applyLabel}</button>
                <button type="submit" className="ghost sm" name={`${filter.name}`} value="" formNoValidate onClick={(e) => { const d = (e.currentTarget.closest("details") as HTMLDetailsElement | null); d?.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((c) => (c.checked = false)); }}>{clearLabel}</button>
              </div>
            </div>
          </details>
        )}
      </span>
    </th>
  );
}
