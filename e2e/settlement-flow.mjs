// Settlement and billing through the UI using the seeded diesel price list.
import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.env.BASE_URL ?? "http://localhost:3100";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${base}/en/login`);
await page.click("button:has-text('Admin')");
await page.waitForURL(`${base}/en`);
await page.click("table a:has-text('JOB-2026-00001')");
await page.waitForLoadState("networkidle");

// TRP-00001 is discharged (30 → 29.75 MT, Zagros, 200 USD advance): preview shows the worked example
const card = page.locator(".card:has(strong:text-is('TRP-2026-00001'))");
const txt = await card.innerText();
assert.match(txt, /Pay[\s\S]*1,190,000/);
assert.match(txt, /Shortage fine[\s\S]*30,000/);
assert.match(txt, /Advance in another currency \(not deducted\): \$200/);
assert.match(txt, /To pay[\s\S]*1,160,000/);
assert.match(txt, /Transporter fee[\s\S]*100,000/);

await card.locator("button:has-text('Settle this trip')").click();
await page.waitForSelector("text=Settled STL-");

// Bill the customer: 29.75 × 55,000 = 1,636,250
await page.click("summary:has-text('Invoice the customer')");
await page.locator("form:has(input[name='tripIds[]'])").locator("button.primary").click();
await page.waitForSelector(".card:has(strong:text-is('TRP-2026-00001')) .badge:text-is('Billed')");
await page.goto(`${base}/en/finance`);
const invoiceRow = page.locator("tr").filter({ hasText: "North Oil Co" }).filter({ hasText: /1,636,250/ });
await invoiceRow.first().waitFor({ timeout: 10000 });
assert.equal(await invoiceRow.count(), 1, "invoice of 29.75 MT × 55,000 IQD");
assert.deepEqual(errors, []);
console.log("e2e settlement flow: OK");
await browser.close();
