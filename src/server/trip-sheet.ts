import "server-only";
import ExcelJS from "exceljs";
import { normalizeName } from "@/domain/masterdata/partners";
import { ValidationError } from "./errors";

/**
 * Reads a trip sheet as the sites and the office keep it today (one row per
 * manifest; headers in Kurdish, Arabic or English) — e.g. the owner's
 * "DIESEL 26-10.xlsx". Only typed-in values are read; formula columns are
 * ignored, because the system calculates them itself from the rule card.
 */

export const SHEET_FIELDS = [
  "loadingDate",
  "route",
  "loadingPlace",
  "dischargePlace",
  "carrierPrice",
  "reward",
  "transporterCommission",
  "advance",
  "transporter",
  "driver",
  "plate",
  "manifest",
  "loadedQty",
  "dischargeDate",
  "dischargedQty",
  "carrierDeduction",
  "transporterCut",
] as const;
export type SheetField = (typeof SHEET_FIELDS)[number];

/** Fee columns, by the fee they hold (matched to the company's fee types by name). */
export const SHEET_FEES = ["guarantee", "insurance", "visa", "entry_slip", "declaration_fee", "border_commission", "customs_rate"] as const;
export type SheetFee = (typeof SHEET_FEES)[number];

const headerKey = (s: string) => normalizeName(s).replace(/[.\-–—_:()،,/\\]/g, " ").replace(/\s+/g, " ").trim();

const FIELD_ALIASES: Record<SheetField, string[]> = {
  loadingDate: ["بەرواری بارکردن", "تاريخ التحميل", "loading date"],
  route: ["محور", "الطريق", "route"],
  loadingPlace: ["شوێنی بارکردن", "مكان التحميل", "loading place"],
  dischargePlace: ["شوێنی بەتاڵکردن", "مكان التفريغ", "discharge place"],
  carrierPrice: ["نرخ تەن", "سعر الطن", "price per ton", "carrier price"],
  reward: ["بخشیش", "مكافأة", "reward"],
  transporterCommission: ["عمولە ناقل", "عمولة الناقل", "transporter commission"],
  advance: ["سلف", "سلفة", "advance"],
  transporter: ["ناقل", "الناقل", "transporter"],
  driver: ["ناو سایەق", "اسم السائق", "driver"],
  plate: ["ژ. سەیارە", "رقم السيارة", "plate"],
  manifest: ["رقم منفیست", "رقم المنفيست", "manifest", "manifest no"],
  loadedQty: ["بڕی بارکراو", "الكمية المحملة", "loaded", "loaded qty"],
  dischargeDate: ["بەرواری بەتاڵکردن", "تاريخ التفريغ", "discharge date"],
  dischargedQty: ["بڕی بەتاڵکراو", "الكمية المفرغة", "discharged", "discharged qty"],
  carrierDeduction: ["لێبڕینی ڤیزا - تآمین", "خصم فيزا تأمين", "visa insurance deduction"],
  transporterCut: ["لێبڕینی ناقل", "لێبڕین بۆ ناقل", "خصم الناقل", "transporter cut"],
};
const FEE_ALIASES: Record<SheetFee, string[]> = {
  guarantee: ["کفالە", "كفالة", "guarantee"],
  insurance: ["تآمین", "تأمين", "insurance"],
  visa: ["فیزا", "فيزا", "visa"],
  entry_slip: ["فیشە دخول", "فيشة دخول", "entry slip"],
  declaration_fee: ["رسم بیان", "رسم البيان", "declaration fee"],
  border_commission: ["عمولە حدود", "عمولة الحدود", "border commission"],
  customs_rate: ["نرخی ١ تەن گومرگ", "سعر طن الكمرك", "customs per ton"],
};

const LOOKUP = new Map<string, { field?: SheetField; fee?: SheetFee }>();
for (const f of SHEET_FIELDS) for (const a of FIELD_ALIASES[f]) LOOKUP.set(headerKey(a), { field: f });
for (const f of SHEET_FEES) for (const a of FEE_ALIASES[f]) LOOKUP.set(headerKey(a), { fee: f });

export interface SheetRow {
  rowNo: number;
  values: Partial<Record<SheetField, string>>;
  fees: Partial<Record<SheetFee, string>>;
}
export interface SheetColumn {
  column: string;
  header: string;
  readAs: string | null;
}
export interface ParsedSheet {
  sheet: string;
  columns: SheetColumn[];
  rows: SheetRow[];
}

const DIGITS = /[٠-٩۰-۹]/g;
const latinDigits = (s: string) => s.replace(DIGITS, (d) => String((d.charCodeAt(0) & 0xf) % 10));

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v && typeof v === "object") {
    if ("formula" in v || "sharedFormula" in v) return undefined; // calculated in the sheet: the system calculates it itself
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return (v as { text: string }).text;
    if (v instanceof Date) return v;
  }
  return v;
}

const iso = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

function asDate(v: unknown): string | undefined {
  if (v instanceof Date) return iso(v);
  if (typeof v === "number" && v > 20000 && v < 80000) return iso(new Date(Date.UTC(1899, 11, 30) + v * 86400000)); // Excel serial date
  if (typeof v === "string") {
    const s = latinDigits(v.trim());
    const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/) ?? null;
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    const d = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (d) return `${d[3]}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}`;
  }
  return undefined;
}

function asNumber(v: unknown): string | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return String(Math.round(v * 1e6) / 1e6);
  if (typeof v === "string") {
    const s = latinDigits(v.trim()).replace(/[,\s]/g, "").replace("٫", ".");
    if (/^-?\d+(\.\d+)?$/.test(s)) return s;
  }
  return undefined;
}

function asText(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = (v instanceof Date ? iso(v) : String(v)).replace(/\s+/g, " ").trim();
  return s || undefined;
}

const DATE_FIELDS: SheetField[] = ["loadingDate", "dischargeDate"];
const NUMBER_FIELDS: SheetField[] = ["carrierPrice", "reward", "transporterCommission", "advance", "loadedQty", "dischargedQty", "carrierDeduction", "transporterCut"];

/** Read the first sheet that has a recognisable header row (within its first 10 rows). */
export async function parseTripSheet(data: ArrayBuffer): Promise<ParsedSheet> {
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
      const map = new Map<number, { field?: SheetField; fee?: SheetFee }>();
      row.eachCell((cell, col) => {
        const header = asText(cellValue(cell.value));
        if (!header) return;
        const hit = LOOKUP.get(headerKey(header));
        columns.push({ column: cell.address.replace(/\d+$/, ""), header, readAs: hit?.field ?? (hit?.fee ? `fee:${hit.fee}` : null) });
        if (hit) map.set(col, hit);
      });
      const fields = new Set([...map.values()].map((h) => h.field).filter(Boolean));
      if (!(fields.has("manifest") || fields.has("driver")) || map.size < 4) continue;

      const rows: SheetRow[] = [];
      for (let i = r + 1; i <= ws.rowCount; i++) {
        const out: SheetRow = { rowNo: i, values: {}, fees: {} };
        const cells = ws.getRow(i);
        for (const [col, hit] of map) {
          const v = cellValue(cells.getCell(col).value);
          if (hit.field) {
            const parsed = DATE_FIELDS.includes(hit.field) ? asDate(v) : NUMBER_FIELDS.includes(hit.field) ? asNumber(v) : asText(v);
            if (parsed !== undefined) out.values[hit.field] = parsed;
          } else if (hit.fee) {
            const n = asNumber(v);
            if (n !== undefined) out.fees[hit.fee] = n;
          }
        }
        if (out.values.manifest || out.values.driver || out.values.loadedQty) rows.push(out);
      }
      return { sheet: ws.name, columns, rows };
    }
  }
  throw new ValidationError("No trip table found: the sheet needs a header row with at least the manifest or driver column");
}
