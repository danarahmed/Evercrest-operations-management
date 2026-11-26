// Fees the driver paid (owner's rules, 2026-11), through the real UI: the job puts the visa on the customer's
// invoice from a date; a trip's visa paid by the driver; the claim refuses it without the receipt and takes it
// when the receipt comes with the claim; the driver's money comes back on the claim, not as a job cost.
// Usage: BASE_URL=http://localhost:3100 node e2e/driver-fees-flow.mjs   (needs AUTH_MODE=dev + seeded dev data)
import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.env.BASE_URL ?? "http://localhost:3100";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
const submit = ".form-actions button >> nth=0";
const dlg = (cmd) => page.locator(`dialog[open] form:has(input[name=__command][value='${cmd}'])`);
const closed = () => page.waitForSelector("dialog[open]", { state: "detached" });
const M = `E2E-DRV-${Date.now() % 100000}`;
const today = new Date().toISOString().slice(0, 10);

await page.goto(`${base}/en/login`);
await page.click("button:has-text('Admin')");
await page.waitForURL(`${base}/en`);
await page.goto(`${base}/en/jobs`);
const job = `${base}${await page.locator("a:has-text('Diesel to Field X')").first().getAttribute("href")}`;

// The rule card: the visa goes on the customer's invoice from today.
await page.goto(`${job}?tab=rules`);
await page.click("button:has-text('Change from a date')");
let f = dlg("job_billed_fees.set");
await f.locator("input[name=effectiveFrom]").fill(today);
await f.locator("label.check:has-text('Visa') input").check();
await f.locator(submit).click();
await closed();
await page.waitForSelector("td:has-text('Visa')");

// A trip whose visa the driver paid, receipt not yet brought.
await page.goto(`${job}?tab=trips`);
await page.click("a:has-text('New trip')");
f = dlg("trips.save");
await f.locator("input[name=manifestNo]").fill(M);
await f.locator("input[name=driverName]").fill("Driver Paid Fee");
await f.locator("input[name=plate]").fill("66 D 66666");
await f.locator("input[name=loadingDate]").fill(today);
await f.locator("input[name=loadedQty]").fill("30");
await f.locator("input[name=dischargeDate]").fill(today);
await f.locator("input[name=dischargedQty]").fill("30");
const visaRow = f.locator(".fee-row:has-text('Visa')");
await visaRow.locator("input[type=checkbox][name^=fee_]").check();
await visaRow.locator("select[name^=feePaidBy_]").selectOption("carrier");
await f.locator(submit).click();
await closed();
const row = page.locator(`form.trip-filter-form tbody tr:has-text("${M}")`);
await row.waitFor();
assert.match(await row.innerText(), /\$2,150/, "carrier pay = 30 × 70 + 50 visa paid back");

// The claim refuses it without the receipt…
await page.goto(`${job}?tab=claims`);
await page.click("button:has-text('New claim')");
let nc = page.locator("dialog[open] form");
await nc.locator("input[name=claimant]").fill("Zagros Transport");
await nc.locator("textarea[name=m]").fill(M);
await nc.locator("button:has-text('Check the manifests')").click();
await page.waitForSelector("text=Check: 1 manifest");
assert.match(await page.locator("table tbody tr").first().innerText(), /Fee receipt missing/);

// …and takes it when the receipt comes with the claim.
await page.click("a:has-text('Start over')");
await page.click("button:has-text('New claim')");
nc = page.locator("dialog[open] form");
await nc.locator("input[name=claimant]").fill("Zagros Transport");
await nc.locator("textarea[name=m]").fill(M);
await nc.locator("input[name=rc]").check();
await nc.locator("button:has-text('Check the manifests')").click();
await page.waitForSelector("text=Check: 1 manifest");
assert.match(await page.locator("table tbody tr").first().innerText(), /Ready/);
await page.locator("form:has(input[name=__command][value='claims.create'])").locator(submit).click();
await page.waitForURL(/\/en\/claims\/[0-9a-f-]{36}$/);
// The books: the driver's visa is owed by the customer (Fees to bill customers), not a job cost.
assert.match(await page.locator("table:has-text('Debit')").innerText(), /1150 Fees to bill customers/);

assert.deepEqual(errors, []);
console.log("e2e driver-paid fees flow: OK");
await browser.close();
