import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseTripSheet } from "@/server/trip-sheet";

async function sheet(rows: unknown[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("x");
  for (const r of rows) ws.addRow(r);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

describe("reading sheets", () => {
  it("reads a storage's discharge list: manifest, date and quantity only", async () => {
    const parsed = await parseTripSheet(await sheet([["رقم منفیست", "بەرواری بەتاڵکردن", "بڕی بەتاڵکراو"], ["H-401", "2026-11-10", 30.68], ["H-402", "2026-11-10", 30.1]]));
    expect(parsed.rows.map((r) => r.values)).toEqual([
      { manifest: "H-401", dischargeDate: "2026-11-10", dischargedQty: "30.68" },
      { manifest: "H-402", dischargeDate: "2026-11-10", dischargedQty: "30.1" },
    ]);
  });

  it("reads the cash box an advance was paid from, in Kurdish, Arabic or English headers", async () => {
    for (const header of ["سندووق", "الصندوق", "Cash box"]) {
      const parsed = await parseTripSheet(await sheet([["رقم منفیست", "ناو سایەق", "ژ. سەیارە", "بڕی بارکراو", "سلف", header], ["H-1", "Hemin", "22 C 1", 30, 500, "Site box Rabia"]]));
      expect(parsed.rows[0].values).toMatchObject({ advance: "500", cashBox: "Site box Rabia" });
    }
  });

  it("still refuses a table it cannot recognise", async () => {
    await expect(parseTripSheet(await sheet([["name", "phone"], ["a", "1"]]))).rejects.toThrow(/No trip table found/);
  });
});
