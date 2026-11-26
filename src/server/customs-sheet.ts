import "server-only";
import ExcelJS from "exceljs";
import { ValidationError } from "./errors";
import { asNumber, asText, cellValue, headerKey } from "./trip-sheet";

/**
 * Reads the border person's customs statement: one row per truck with the manifest and the MT customs counted
 * (and, when he gives it, the amount). Headers in Kurdish, Arabic or English. Formula results are read.
 */
const FIELDS = ["manifest", "plate", "quantity", "amount"] as const;
type Field = (typeof FIELDS)[number];
const ALIASES: Record<Field, string[]> = {
  manifest: ["رقم منفیست", "رقم المنفيست", "منفیست", "المنفيست", "manifest", "manifest no"],
  plate: ["ژ. سەیارە", "ژمارەی سەیارە", "رقم السيارة", "plate"],
  quantity: ["بڕی گومرگ", "تەنی گومرگ", "بڕ", "تەن", "كمية الكمرك", "كمية الجمارك", "الكمية", "الوزن", "طن", "mt", "tons", "quantity", "qty", "customs mt", "weight"],
  amount: ["بڕی پارە", "پارە", "المبلغ", "الرسوم", "amount", "duty", "customs", "total"],
};
const LOOKUP = new Map<string, Field>();
for (const f of FIELDS) for (const a of ALIASES[f]) LOOKUP.set(headerKey(a), f);

export interface CustomsSheetRow {
  rowNo: number;
  manifest?: string;
  plate?: string;
  quantity?: string;
  amount?: string;
}

export async function parseCustomsSheet(data: ArrayBuffer): Promise<CustomsSheetRow[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data);
  } catch {
    throw new ValidationError("This file could not be read as an Excel workbook (.xlsx)");
  }
  for (const ws of wb.worksheets) {
    for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
      const map = new Map<number, Field>();
      ws.getRow(r).eachCell((cell, col) => {
        const header = asText(cellValue(cell.value));
        const hit = header ? LOOKUP.get(headerKey(header)) : undefined;
        if (hit && ![...map.values()].includes(hit)) map.set(col, hit);
      });
      const fields = new Set(map.values());
      if (!fields.has("manifest") || !fields.has("quantity")) continue;
      const rows: CustomsSheetRow[] = [];
      for (let i = r + 1; i <= ws.rowCount; i++) {
        const out: CustomsSheetRow = { rowNo: i };
        const cells = ws.getRow(i);
        for (const [col, f] of map) {
          const raw = cells.getCell(col).value;
          const v = raw && typeof raw === "object" && "result" in raw ? (raw as { result: unknown }).result : cellValue(raw);
          const parsed = f === "quantity" || f === "amount" ? asNumber(v) : asText(v);
          if (parsed !== undefined) out[f] = parsed;
        }
        if (out.manifest) rows.push(out);
      }
      return rows;
    }
  }
  throw new ValidationError("No customs table found: the sheet needs a header row with the manifest and the MT");
}
