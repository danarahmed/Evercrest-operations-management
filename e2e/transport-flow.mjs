// End-to-end check of the main transport flow through the real UI.
// Usage: BASE_URL=http://localhost:3100 node e2e/transport-flow.mjs   (needs AUTH_MODE=dev + seeded dev data)
import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.env.BASE_URL ?? "http://localhost:3100";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${base}/en/login`);
await page.click("button.primary");
await page.waitForURL(`${base}/en`);

// New job → redirected to its workspace
await page.click("text=+ New job");
await page.selectOption("select[name=customerId]", { label: "North Oil Co" });
await page.selectOption("select[name=jobTypeId]", { label: "Petroleum transportation" });
await page.fill("input[name=name]", "E2E diesel run");
await page.click("button:has-text('Create job')");
await page.waitForURL(/\/en\/jobs\/[0-9a-f-]{36}$/);
assert.match(await page.textContent("h1"), /E2E diesel run/);

// Start a trip with only a new driver name and a plate; double-click must not create two trips
await page.click("summary:has-text('Start a trip')");
const tripForm = page.locator("form:has(input[name=truckPlate])");
await tripForm.locator("input[name=newDriverName]").fill("Hemin Aziz");
await tripForm.locator("input[name=truckPlate]").fill("33 C 12345");
await tripForm.locator("button.primary").dblclick();
await page.waitForSelector("text=Saved.");
await page.reload();
assert.equal(await page.locator("table tbody tr:has-text('Hemin Aziz')").count(), 1, "exactly one trip after double click");

// Loading
await page.click("summary:has-text('Record loading')");
const load = page.locator("form:has(input[name=loadedQty])");
await load.locator("input[name=loadedQty]").fill("30");
await load.locator("button.primary").click();
await page.waitForSelector("text=Saved.");

// Advance in IQD
await page.reload();
await page.click("summary:has-text('Pay an advance')");
const adv = page.locator("form:has(input[name=purpose][value=advance])");
await adv.locator("select[name=moneyAccountId]").selectOption({ label: "Main safe IQD (IQD)" });
await adv.locator("input[name=amount]").fill("150000");
await adv.locator("button.primary").click();
await page.waitForSelector("text=Saved.");

// Validation error is shown, not a crash
await page.reload();
await page.click("summary:has-text('Record discharge')");
const dis = page.locator("form:has(input[name=dischargedQty])");
await dis.locator("input[name=dischargeDate]").fill("2000-01-01");
await dis.locator("input[name=dischargedQty]").fill("30");
await dis.locator("button.primary").click();
await page.waitForSelector("text=Discharge date cannot be before the loading date");

// Advance above the limit → held for approval → approved by a different person
await page.reload();
await page.click("summary:has-text('Pay an advance')");
const big = page.locator("form:has(input[name=purpose][value=advance])");
await big.locator("select[name=moneyAccountId]").selectOption({ label: "Main safe USD (USD)" });
await big.locator("input[name=amount]").fill("2500");
await big.locator("button.primary").click();
await page.waitForSelector("text=Approval needed");
await big.locator("button:has-text('Send for approval')").click();
await page.waitForSelector("text=Saved.");
const jobUrl = page.url();
await page.goto(`${base}/en/approvals`);
await page.waitForSelector("text=another person must decide");
await page.click("button:has-text('Sign out')");
await page.waitForURL(`${base}/en/login`);
await page.click("button:has-text('Finance Manager')");
await page.waitForURL(`${base}/en`);
await page.goto(`${base}/en/approvals`);
await page.locator("form:has(input[name=requestId])").first().locator("button.primary").click();
await page.waitForSelector("text=Nothing is waiting for approval.");
await page.goto(jobUrl);

const row = await page.locator("table tbody tr:has-text('Hemin Aziz')").innerText();
assert.match(row, /30 MT/);
assert.match(row, /150,000/);
assert.match(row, /\$2,500/, "approved advance is posted");
assert.deepEqual(errors, []);
console.log("e2e transport flow: OK");
await browser.close();
