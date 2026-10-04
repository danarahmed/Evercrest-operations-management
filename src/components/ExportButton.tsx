"use client";
import { Icon } from "./icons";

/**
 * Downloads the tables on the current screen as a CSV file (UTF-8 with BOM so
 * Excel shows Arabic and Kurdish correctly). Exports what the user sees: the
 * same rows, the same formatted amounts with their currency.
 */
export function ExportButton({ label, filename }: { label: string; filename: string }) {
  const run = () => {
    const tables = [...document.querySelectorAll<HTMLTableElement>("main table")];
    const esc = (v: string) => (/[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const blocks = tables.map((table) => {
      const title = table.closest(".card")?.querySelector(".card-title")?.textContent?.trim();
      const rows = [...table.rows].map((r) => [...r.cells].map((c) => esc((c.innerText || "").replace(/[\u2066-\u2069]/g, "").replace(/\s*\n\s*/g, " ").trim())).join(","));
      return [...(title ? [esc(title)] : []), ...rows].join("\n");
    });
    const blob = new Blob(["﻿" + blocks.join("\n\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <button type="button" onClick={run} className="no-print">
      <Icon name="download" size={16} />
      {label}
    </button>
  );
}
