// End-to-end check of the main transport flow through the real UI: one screen per trip,
// the entry grid, corrections with history, and an advance that needs approval.
// Usage: BASE_URL=http://localhost:3100 node e2e/transport-flow.mjs   (needs AUTH_MODE=dev + seeded dev data)
import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.env.BASE_URL ?? "http://localhost:3100";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());

const submit = ".form-actions button >> nth=0";
const dialogForm = () => page.locator("dialog[open] form:has(input[name=__command][value='trips.save'])");
const closed = () => page.waitForSelector("dialog[open]", { state: "detached" });
const at = async (re) => { for (let i = 0; i < 80; i++) { if (re.test(page.url())) return; await page.waitForTimeout(250); } throw new Error(`still at ${page.url()}, wanted ${re}`); };

await page.goto(`${base}/en/login`);
await page.click("button:has-text('Admin')");
await page.waitForURL(`${base}/en`);

// New job → redirected to its workspace
await page.click("a:has-text('New job')");
await page.selectOption("select[name=customerId]", { label: "North Oil Co" });
await page.selectOption("select[name=jobTypeId]", { label: "Petroleum transportation" });
await page.fill("input[name=name]", "E2E diesel run");
await page.click("button:has-text('Create job')");
await page.waitForURL(/\/en\/jobs\/[0-9a-f-]{36}$/);
assert.match(await page.textContent("h1"), /E2E diesel run/);
const jobUrl = page.url();
const trips = `${jobUrl}?tab=trips`;
await page.goto(trips);

// One screen: a new trip with driver, plate, manifest and loading in one go; double-click must not create two trips
await page.click("a:has-text('New trip')");
await at(/trip=new/);
let form = dialogForm();
await form.locator("input[name=manifestNo]").fill("E2E-1");
await form.locator("input[name=driverName]").fill("Hemin Aziz");
await form.locator("input[name=plate]").fill("33 C 12345");
await form.locator("input[name=loadedQty]").fill("30");
await form.locator(submit).dblclick();
await closed();
await at(/tab=trips$/);
await page.reload();
assert.equal(await page.locator("table tbody tr:has-text('Hemin Aziz')").count(), 1, "exactly one trip after double click");

// Open the trip and pay an advance in IQD from the same screen
await page.click("a:has-text('E2E-1')");
await at(/trip=/);
form = dialogForm();
await form.locator("input[name=advanceAmount]").fill("150000");
await form.locator("select[name=advanceMoneyAccountId]").selectOption({ label: "Main safe IQD (IQD)" });
await form.locator(submit).click();
await closed();

// A validation error is shown in the dialog, not a crash
await page.goto(trips);
await page.click("a:has-text('E2E-1')");
await at(/trip=/);
form = dialogForm();
await form.locator("input[name=dischargeDate]").fill("2000-01-01");
await form.locator("input[name=dischargedQty]").fill("30");
await form.locator(submit).click();
await form.locator(".form-msg.error", { hasText: "Discharge date cannot be before the loading date" }).waitFor();

// A correction is recorded with before → after in the trip's history
await form.locator("input[name=dischargeDate]").fill("");
await form.locator("input[name=dischargedQty]").fill("");
await form.locator("input[name=loadedQty]").fill("30.5");
await form.locator("input[name=reason]").fill("manifest says 30.5");
await form.locator(submit).click();
await closed();
await page.goto(trips);
await page.click("a:has-text('E2E-1')");
await at(/trip=/);
const history = await page.locator("dialog[open] .history-diff").first().innerText();
assert.match(history, /30\.5/);
assert.match(await page.locator("dialog[open]").innerText(), /manifest says 30\.5/);

// Advance above the limit → held for approval → approved by a different person
form = dialogForm();
await form.locator("input[name=advanceAmount]").fill("2500");
await form.locator("select[name=advanceMoneyAccountId]").selectOption({ label: "Main safe USD (USD)" });
await form.locator(submit).click();
await form.locator(".form-msg.error", { hasText: "Approval needed" }).waitFor();
await form.locator("button:has-text('Send for approval')").click();
await closed();
await page.goto(`${base}/en/approvals`);
await page.waitForSelector("text=another person must decide");
await page.click("button[aria-label='Sign out']");
await page.waitForURL(`${base}/en/login`);
await page.click("button:has-text('Finance Manager')");
await page.waitForURL(`${base}/en`);
await page.goto(`${base}/en/approvals`);
await page.locator("form:has(input[name=requestId])").first().locator(submit).click();
await page.waitForSelector("text=Nothing is waiting for approval.");
await page.click("button[aria-label='Sign out']");
await page.waitForURL(`${base}/en/login`);
await page.click("button:has-text('Admin')");
await page.waitForURL(`${base}/en`);
await page.goto(trips);

const row = await page.locator("table tbody tr:has-text('Hemin Aziz')").innerText();
assert.match(row, /30\.5/);
assert.match(row, /150,000/);
assert.match(row, /\$2,500/, "approved advance is posted");

// The entry grid: two trucks typed in two rows, one save
const cell = (i, f) => page.locator(`[data-cell="${i}:${f}"]`);
await page.locator("summary:has-text('Enter trips')").click();
await cell(0, "driver").fill("Grid One");
await cell(0, "plate").fill("44 D 1001");
await cell(0, "manifest").fill("E2E-G1");
await cell(0, "loadedQty").fill("31");
await cell(0, "dischargedQty").press("Tab");
await cell(1, "driver").fill("Grid Two");
await cell(1, "plate").fill("44 D 1002");
await cell(1, "manifest").fill("E2E-G2");
await cell(1, "loadedQty").fill("32");
await page.click("button:has-text('Save all rows')");
await page.waitForSelector("table tbody tr:has-text('Grid Two')");
assert.equal(await page.locator("table tbody tr:has-text('E2E-G1')").count(), 1);

// Filters: search narrows the rows and the totals follow
await page.goto(`${trips}&q=Grid`);
assert.equal(await page.locator("form.trip-filter-form tbody tr").count(), 2);
await page.goto(`${trips}&chip=noadvance`);
assert.equal(await page.locator("form.trip-filter-form tbody tr:has-text('Hemin Aziz')").count(), 0);
assert.deepEqual(errors, []);
console.log("e2e transport flow: OK");
await browser.close();
