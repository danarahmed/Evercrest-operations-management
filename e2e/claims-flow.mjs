// Claims through the real UI: a transporter brings manifests, the system checks them,
// the claim is posted to his account and paid from a cash box.
// Usage: BASE_URL=http://localhost:3100 node e2e/claims-flow.mjs   (needs AUTH_MODE=dev + seeded dev data)
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

await page.goto(`${base}/en/login`);
await page.click("button:has-text('Admin')");
await page.waitForURL(`${base}/en`);

// A job with the diesel-style rule card
await page.click("a:has-text('New job')");
await page.selectOption("select[name=customerId]", { label: "North Oil Co" });
await page.selectOption("select[name=jobTypeId]", { label: "Petroleum transportation" });
await page.fill("input[name=name]", "E2E claims run");
await page.click("button:has-text('Create job')");
await page.waitForURL(/\/en\/jobs\/[0-9a-f-]{36}$/);
const jobUrl = page.url();
await page.goto(`${jobUrl}?tab=rules`);
await page.click("button:has-text('New version')");
const rules = page.locator("dialog[open] form:has(input[name=__command][value='job_terms.set'])");
await rules.locator("input[name=carrierPrice]").fill("70");
await rules.locator("input[name=customerPrice]").fill("120");
await rules.locator("input[name=carrierAllowance]").fill("0.15");
await rules.locator("input[name=carrierFinePrice]").fill("1200");
await rules.locator(submit).click();
await page.waitForSelector("dialog[open]", { state: "detached" });

// Two discharged trips: one clean, one with a shortage beyond the allowance
const trips = `${jobUrl}?tab=trips`;
for (const [manifest, driver, plate, discharged] of [["CLM-A1", "Hemin Aziz", "33 C 11111", "30"], ["CLM-A2", "Karwan Ali", "33 C 22222", "29.7"]]) {
  await page.goto(trips);
  await page.click("a:has-text('New trip')");
  const form = dialogForm();
  await form.locator("input[name=manifestNo]").fill(manifest);
  await form.locator("input[name=driverName]").fill(driver);
  await form.locator("input[name=transporterName]").fill("Zagros Transport");
  await form.locator("input[name=plate]").fill(plate);
  await form.locator("input[name=loadedQty]").fill("30");
  await form.locator("input[name=dischargeDate]").fill(new Date().toISOString().slice(0, 10));
  await form.locator("input[name=dischargedQty]").fill(discharged);
  await form.locator(submit).click();
  await closed();
}

// Claims tab: check the manifests (one unknown number among them)
await page.goto(`${jobUrl}?tab=claims`);
await page.click("button:has-text('New claim')");
const nc = page.locator("dialog[open] form");
await nc.locator("input[name=claimant]").fill("Zagros Transport");
await nc.locator("textarea[name=m]").fill("CLM-A1\nCLM-A2\nCLM-404");
await nc.locator("button:has-text('Check the manifests')").click();
await page.waitForSelector("text=Check: 3 manifests");
const rows = page.locator("table tbody tr");
assert.match(await rows.nth(0).innerText(), /Ready/);
assert.match(await rows.nth(1).innerText(), /Ready/);
assert.match(await rows.nth(1).innerText(), /180/); // 0.15 MT beyond the allowance × 1,200
assert.match(await rows.nth(2).innerText(), /No such manifest/);
await page.click("button:has-text('Claim only the 2 ready trips')");
await page.waitForSelector("text=Check: 2 manifests");
assert.match(await page.locator("tfoot").innerText(), /\$3,999/); // 2,100 + 1,899

// Post the claim → its page, Zagros is owed 3,999; the trips are locked
await page.locator("form:has(input[name=__command][value='claims.create'])").locator(submit).click();
await page.waitForURL(/\/en\/claims\/[0-9a-f-]{36}$/);
assert.match(await page.locator("h1").innerText(), /Zagros Transport/);
assert.match(await page.locator(".stats").innerText(), /\$3,999/);
await page.goto(trips);
await page.click("a:has-text('CLM-A1')");
await page.waitForSelector("dialog[open]");
assert.match(await page.locator("dialog[open]").innerText(), /Claimed/);
assert.ok(await page.locator("dialog[open] fieldset[disabled]").count() > 0, "a claimed trip is locked");
await page.keyboard.press("Escape");

// The same manifest cannot be claimed again
await page.goto(`${jobUrl}?tab=claims&claimant=Hemin+Aziz&m=CLM-A1`);
assert.match(await page.locator("table tbody tr").first().innerText(), /Already claimed/);

// Pay part within the payment limit; the rest is above the limit → approval by another person → Paid
await page.click("table a:has-text('CLM-')");
await page.waitForURL(/\/en\/claims\//);
const claimUrl = page.url();
await page.click("button:has-text('Pay')");
let pay = page.locator("dialog[open] form:has(input[name=__command][value='claims.pay'])");
await pay.locator("input[name=amount]").fill("700");
await pay.locator("select[name=moneyAccountId]").selectOption({ label: "Main safe USD (USD)" });
await pay.locator(submit).click();
await page.waitForSelector(".stats:has-text('$3,299')");
await page.click("button:has-text('Pay')");
pay = page.locator("dialog[open] form:has(input[name=__command][value='claims.pay'])");
await pay.locator("select[name=moneyAccountId]").selectOption({ label: "Main safe USD (USD)" });
await pay.locator(submit).click();
await pay.locator(".form-msg.error", { hasText: "Approval needed" }).waitFor();
await pay.locator("button:has-text('Send for approval')").click();
await page.waitForSelector("dialog[open]", { state: "detached" });
await page.hover("aside"); await page.click("button[aria-label='Sign out']");
await page.waitForURL(`${base}/en/login`);
await page.click("button:has-text('Finance Manager')");
await page.waitForURL(`${base}/en`);
await page.goto(`${base}/en/approvals`);
await page.locator("form:has(input[name=requestId])").first().locator(submit).click();
await page.waitForSelector("text=Nothing is waiting for approval.");
await page.goto(claimUrl);
await page.waitForSelector(".badge:has-text('Paid')");
await page.goto(`${base}/en/claims`);
assert.match(await page.locator("table").innerText(), /Zagros Transport[\s\S]*Paid/);

// A payment from the wrong box is reversed from the claim page: the claim opens again for that amount
await page.hover("aside"); await page.click("button[aria-label='Sign out']");
await page.waitForURL(`${base}/en/login`);
await page.click("button:has-text('Admin')");
await page.waitForURL(`${base}/en`);
await page.goto(claimUrl);
await page.locator("tr:has-text('$700') button:has-text('Reverse')").first().click();
const rev = page.locator("dialog[open] form:has(input[name=__command][value='payments.reverse'])");
await rev.locator("input[name=reason]").fill("paid from the wrong safe");
await rev.locator(submit).click();
await page.waitForSelector(".stats:has-text('$700')");
assert.match(await page.locator(".badge").first().innerText(), /Open/);
assert.deepEqual(errors, []);
console.log("e2e claims flow: OK");
await browser.close();
