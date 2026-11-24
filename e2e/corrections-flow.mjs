// Steps 1–2 corrections through the real UI (owner's review, 2026-11): kinds of fees in Setup, prices by route,
// fees ticked on a trip, one fee on many trips, "Pay fees", "Paper not coming", the job team, "My jobs",
// and a contract's payment terms.
// Usage: BASE_URL=http://localhost:3100 node e2e/corrections-flow.mjs   (needs AUTH_MODE=dev + seeded dev data)
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
const today = new Date().toISOString().slice(0, 10);
const M = `E2E-FEE-${Date.now() % 100000}`;

await page.goto(`${base}/en/login`);
await page.click("button:has-text('Admin')");
await page.waitForURL(`${base}/en`);

// Setup → Accounting & money: a kind of fee the customer pays directly, taken back from the carrier
await page.goto(`${base}/en/setup?tab=accounting`);
await page.click("button:has-text('Add a kind of fee')");
let f = dlg("fee_types.define");
await f.locator("input[name=name]").fill("Border slip");
await f.locator("input[name=defaultAmount]").fill("40");
await f.locator("select[name=paidBy]").selectOption("customer");
await f.locator("input[name=deductFromCarrier]").check();
await f.locator(submit).click();
await closed();
await page.waitForSelector("tr:has-text('Border slip'):has-text('the customer directly')");

// The job's rule card: a route with its own price
await page.goto(`${base}/en/jobs`);
const jobHref = await page.locator("a:has-text('Diesel to Field X')").first().getAttribute("href");
const job = `${base}${jobHref}`;
await page.goto(`${job}?tab=rules`);
await page.click("button:has-text('Set a route price')");
f = dlg("route_prices.set");
await f.locator("select[name=routeId]").selectOption("");
await f.locator("input[name=routeName]").fill("Erbil – Field X");
await f.locator("input[name=effectiveFrom]").fill("2026-01-01");
await f.locator("input[name=carrierPrice]").fill("80");
await f.locator("input[name=rewardPerTrip]").fill("15");
await f.locator(submit).click();
await closed();
await page.waitForSelector("tr:has-text('Erbil – Field X'):has-text('in force')");

// A trip on that route, with the visa ticked: priced at the route's 80
await page.goto(`${job}?tab=trips`);
await page.click("a:has-text('New trip')");
f = dlg("trips.save");
await f.locator("input[name=manifestNo]").fill(M);
await f.locator("select[name=routeId]").selectOption({ label: "Erbil – Field X" });
await f.locator("input[name=driverName]").fill("Hemin Aziz");
await f.locator("input[name=plate]").fill("33 C 12345");
await f.locator("input[name=loadedQty]").fill("30");
const visaBox = f.locator("label.check:has-text('Visa') input[type=checkbox]");
await visaBox.check();
await f.locator(submit).click();
await closed();
const row = page.locator(`form.trip-filter-form tbody tr:has-text("${M}")`);
await row.waitFor();
assert.match(await row.innerText(), /\$2,365/, "carrier pay = 30 × 80 (the route's price) + 15 reward − 50 visa");

// One fee on many trips: customs on this trip by its manifest
await page.click("button:has-text('Add a fee to trips')");
f = dlg("trip_fees.add_many");
await f.locator("select[name=feeTypeId]").selectOption(await f.locator("select[name=feeTypeId] option", { hasText: "Customs" }).first().getAttribute("value"));
await f.locator("textarea[name=manifests]").fill(M);
await f.locator(submit).click();
await closed();

// Pay fees: fees still open (visa, customs); pay one of them as one payment
const unpaidCount = async () => Number((await page.locator("button:has-text('Pay fees')").first().innerText()).match(/\((\d+)\)/)?.[1] ?? 0);
const before = await unpaidCount();
assert.ok(before >= 2, "at least the visa and the customs of this trip are unpaid");
await page.click("button:has-text('Pay fees')");
const pay = page.locator("dialog[open]");
// The customs (30 × 30 MT = 900 each) are above the 750 payment limit: pay one visa (50) now instead.
await pay.locator("details summary:has-text('Visa')").click();
const boxes = pay.locator("details[open] input[name='tripFeeIds[]']");
for (let i = 1; i < (await boxes.count()); i++) await boxes.nth(i).uncheck();
await pay.locator("details[open] form .form-actions button").first().click();
await closed();
await page.goto(`${job}?tab=trips`);
assert.equal(await unpaidCount(), before - 1, "one fee paid");

// Documents: a manifest that will never come goes to approval
await page.goto(`${job}?tab=documents`);
const missingRow = page.locator("tr:has-text('Manifest'):has(button:has-text('Paper not coming'))").first();
await missingRow.locator("button:has-text('Paper not coming')").click();
f = dlg("documents.waive");
await f.locator("input[name=reason]").fill("lost at the border");
await f.locator(submit).click(); // one click: it always needs approval
await closed();
await page.goto(`${job}?tab=documents`);
await page.waitForSelector("text=Waiting for approval");

// The job team, and "My jobs"
await page.goto(job);
await page.click("button:has-text('Team')");
f = dlg("jobs.set_team");
await f.locator("label.check:not(:has-text('Admin')) input[name='memberUserIds[]']").first().check();
await f.locator(submit).click();
await closed();
await page.waitForSelector("dt:has-text('Team')");
await page.goto(`${base}/en/jobs?mine=1`);
await page.waitForSelector("a:has-text('Diesel to Field X')");

// A contract's payment terms
await page.goto(`${base}/en/setup?tab=operations`);
const contractRow = page.locator("tr:has-text('NO-2026-01')");
await contractRow.locator("button:has-text('Edit')").click();
f = dlg("contracts.update");
await f.locator("input[name=paymentTermsDays]").fill("30");
await f.locator(submit).click();
await closed();
await page.waitForSelector("tr:has-text('NO-2026-01'):has-text('30 days')");

assert.deepEqual(errors, []);
void today;
console.log("e2e corrections flow: OK");
await browser.close();
