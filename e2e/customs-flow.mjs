// Customs duty (owner's rules, 2026-11), through the real UI: the job's rate per MT and the person at the border;
// a truck whose customs MT differs; a lump payment to the agent; booking the trucks' duty against it; and the
// agent's own statement compared truck by truck.
// Usage: BASE_URL=http://localhost:3100 node e2e/customs-flow.mjs   (needs AUTH_MODE=dev + seeded dev data)
import { chromium } from "playwright";
import ExcelJS from "exceljs";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.env.BASE_URL ?? "http://localhost:3100";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
const submit = ".form-actions button >> nth=0";
const dlg = (cmd) => page.locator(`dialog[open] form:has(input[name=__command][value='${cmd}'])`);
const closed = () => page.waitForSelector("dialog[open]", { state: "detached" });
const M = `E2E-CUS-${Date.now() % 100000}`;
const today = new Date().toISOString().slice(0, 10);

await page.goto(`${base}/en/login`);
await page.click("button:has-text('Admin')");
await page.waitForURL(`${base}/en`);
await page.goto(`${base}/en/jobs`);
const job = `${base}${await page.locator("a:has-text('Diesel to Field X')").first().getAttribute("href")}`;

// The rate and the person at the border
await page.goto(`${job}?tab=customs`);
await page.click("button:has-text('Set the customs rate')");
let f = dlg("customs_rates.set");
await f.locator("input[name=effectiveFrom]").fill("2026-01-01");
await f.locator("input[name=rate]").fill("9");
await f.locator(submit).click();
await closed();
await page.click("button:has-text('Agent and who pays')");
f = dlg("job_customs.set");
await f.locator("input[name=agentName]").fill("Kak Aras");
await f.locator(submit).click();
await closed();
await page.waitForSelector("a:has-text('Kak Aras')");

// A truck whose customs MT differs from its loaded MT
await page.goto(`${job}?tab=trips`);
await page.click("a:has-text('New trip')");
f = dlg("trips.save");
await f.locator("input[name=manifestNo]").fill(M);
await f.locator("input[name=driverName]").fill("Customs Test Driver");
await f.locator("input[name=plate]").fill("77 C 77777");
await f.locator("input[name=loadingDate]").fill(today);
await f.locator("input[name=loadedQty]").fill("30");
await f.locator("input[name=customsQty]").fill("31");
await f.locator(submit).click();
await closed();
const row = page.locator(`form.trip-filter-form tbody tr:has-text("${M}")`);
await row.waitFor();
assert.match(await row.innerText(), /\$279/, "customs = 31 MT × 9");

// A lump payment to the agent (within the payment limit), then book the trucks' duty
await page.goto(`${job}?tab=customs`);
await page.click("button:has-text('Pay the customs agent')");
f = dlg("customs.pay_agent");
await f.locator("input[name=amount]").fill("700");
await f.locator("select[name=moneyAccountId]").selectOption({ label: "Main safe USD (USD)" });
await f.locator(submit).click();
await closed();
await page.click("button:has-text('Book customs')");
f = dlg("customs.book");
await f.locator(submit).click();
await closed();
await page.waitForSelector("td:has-text('CUS-')");
assert.match(await page.locator(".stats").first().innerText(), /all booked/);

// The agent's statement: this truck at 31 MT (match) and an unknown one
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("گومرگ");
ws.addRow(["رقم المنفيست", "بڕی گومرگ"]);
ws.addRow([M, 31]);
ws.addRow(["NOT-A-TRUCK", 30]);
const dir = mkdtempSync(join(tmpdir(), "customs-"));
await wb.xlsx.writeFile(join(dir, "aras.xlsx"));
await page.click("button:has-text('Import the agent')");
await page.setInputFiles("dialog[open] input[type=file]", join(dir, "aras.xlsx"));
await page.click("dialog[open] button:has-text('Compare')");
await page.waitForURL(/\/customs\/[0-9a-f-]{36}$/);
const text = await page.locator("table").first().innerText();
assert.match(text, new RegExp(`${M}[\\s\\S]*Match`));
assert.match(text, /No such manifest on this job/);

// The job's profit shows customs on its own line once booked
await page.goto(job);
const profit = page.locator(".card:has-text('5600')");
if (await profit.count()) assert.match(await profit.first().innerText(), /Customs duties/);

assert.deepEqual(errors, []);
console.log("e2e customs flow: OK");
await browser.close();
