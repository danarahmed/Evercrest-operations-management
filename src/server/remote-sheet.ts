import "server-only";
import ExcelJS from "exceljs";
import { ValidationError } from "./errors";
import { asNumber, asText, cellValue, headerKey, type SheetColumn } from "./trip-sheet";

/**
 * Reads a settlement sheet made at a site with the site's own figures: one row
 * per manifest with what was actually paid to the driver. Headers in Kurdish,
 * Arabic or English. Only the manifest and the paid amount are needed; the
 * driver, plate, fine and advance columns are kept for the comparison screen.
 */
export const REMOTE_FIELDS = ["manifest", "driver", "plate", "paid", "fine", "advance", "loadedQty", "dischargedQty"] as const;
export type RemoteField = (typeof REMOTE_FIELDS)[number];

const ALIASES: Record<RemoteField, string[]> = {
  manifest: ["رقم منفیست", "رقم المنفيست", "منفیست", "manifest", "manifest no"],
  driver: ["ناو سایەق", "ناوی شۆفێر", "اسم السائق", "السائق", "driver"],
  plate: ["ژ. سەیارە", "ژمارەی سەیارە", "رقم السيارة", "plate"],
  paid: ["دراوە", "بڕی دراو", "المدفوع", "المبلغ المدفوع", "الصافي", "صافي", "paid", "amount paid", "net", "to pay", "total"],
  fine: ["غرامە", "غرامة", "fine"],
  advance: ["سلف", "سلفە", "سلفة", "advance"],
  loadedQty: ["بڕی بارکراو", "الكمية المحملة", "loaded", "loaded qty"],
  dischargedQty: ["بڕی بەتاڵکراو", "الكمية المفرغة", "discharged", "discharged qty"],
};
const LOOKUP = new Map<string, RemoteField>();
for (const f of REMOTE_FIELDS) for (const a of ALIASES[f]) LOOKUP.set(headerKey(a), f);
const NUMBERS: RemoteField[] = ["paid", "fine", "advance", "loadedQty", "dischargedQty"];

export interface RemoteRow {
  rowNo: number;
  values: Partial<Record<RemoteField, string>>;
}

export async function parseRemoteSheet(data: ArrayBuffer): Promise<{ sheet: string; columns: SheetColumn[]; rows: RemoteRow[] }> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data);
  } catch {
    throw new ValidationError("This file could not be read as an Excel workbook (.xlsx)");
  }
  for (const ws of wb.worksheets) {
    for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
      const row = ws.getRow(r);
      const columns: SheetColumn[] = [];
      const map = new Map<number, RemoteField>();
      row.eachCell((cell, col) => {
        const header = asText(cellValue(cell.value));
        if (!header) return;
        const hit = LOOKUP.get(headerKey(header));
        columns.push({ column: cell.address.replace(/\d+$/, ""), header, readAs: hit ?? null });
        if (hit && !map.has(col)) map.set(col, hit);
      });
      const fields = new Set(map.values());
      if (!fields.has("manifest") || !fields.has("paid")) continue;
      const rows: RemoteRow[] = [];
      for (let i = r + 1; i <= ws.rowCount; i++) {
        const out: RemoteRow = { rowNo: i, values: {} };
        const cells = ws.getRow(i);
        for (const [col, f] of map) {
          // The paid amount is read even when it is a formula result (the site's sheet calculates it).
          const raw = cells.getCell(col).value;
          const v = f === "paid" && raw && typeof raw === "object" && "result" in raw ? (raw as { result: unknown }).result : cellValue(raw);
          const parsed = NUMBERS.includes(f) ? asNumber(v) : asText(v);
          if (parsed !== undefined) out.values[f] = parsed;
        }
        if (out.values.manifest) rows.push(out);
      }
      return { sheet: ws.name, columns, rows };
    }
  }
  throw new ValidationError("No settlement table found: the sheet needs a header row with the manifest and the paid amount");
}
