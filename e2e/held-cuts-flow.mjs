// Held cuts and deductions kept by the company (owner's rules, 2026-11), through the real UI:
// a trip with a cut held for the transporter and a deduction ticked; claimed; the cut given back for less (the rest kept),
// which waits for approval; approved by a second person; then reversed.
// Usage: BASE_URL=http://localhost:3100 node e2e/held-cuts-flow.mjs   (needs AUTH_MODE=dev + seeded dev data)
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
const M = `E2E-CUT-${Date.now() % 100000}`;
const login = async (who) => { await page.goto(`${base}/en/login`); await page.click(`button:has-text('${who}')`); await page.waitForURL(`${base}/en`); };

await login("Admin");
await page.goto(`${base}/en/jobs`);
const job = `${base}${await page.locator("a:has-text('Diesel to Field X')").first().getAttribute("href")}`;

// A trip discharged in full, with 75 cut from the driver for the transporter, and the claim handling deduction ticked.
await page.goto(`${job}?tab=trips`);
await page.click("a:has-text('New trip')");
let f = dlg("trips.save");
await f.locator("input[name=manifestNo]").fill(M);
await f.locator("input[name=driverName]").fill("Cut Test Driver");
await f.locator("input[name=transporterName]").fill("Masoud Transport");
await f.locator("input[name=plate]").fill("55 C 55555");
await f.locator("input[name=loadedQty]").fill("30");
await f.locator("input[name=dischargeDate]").fill(new Date().toISOString().slice(0, 10));
await f.locator("input[name=dischargedQty]").fill("30");
await f.locator("input[name=transporterCut]").fill("75");
await f.locator("label.check:has-text('Claim handling') input[type=checkbox]").check();
await f.locator(submit).click();
await closed();
const row = page.locator(`form.trip-filter-form tbody tr:has-text("${M}")`);
await row.waitFor();
assert.match(await row.innerText(), /\$2,000/, "carrier pay = 30 × 70 − 75 cut − 25 kept");

// Claimed by Zagros, who brings the papers.
await page.goto(`${job}?tab=claims`);
await page.click("button:has-text('New claim')");
const nc = page.locator("dialog[open] form");
await nc.locator("input[name=claimant]").fill("Zagros Transport");
await nc.locator("textarea[name=m]").fill(M);
await nc.locator("button:has-text('Check the manifests')").click();
await page.waitForSelector("text=Check: 1 manifest");
await page.locator("form:has(input[name=__command][value='claims.create'])").locator(submit).click();
await page.waitForURL(/\/en\/claims\/[0-9a-f-]{36}$/);
await page.waitForSelector("th:has-text('Kept by the company')");

// The cut is held; Masoud asks for it: give back 60, keep 15. Waits for approval.
await page.goto(`${base}/en/claims/held?do=give&m=${M}`);
const g = page.locator("form:has(input[name=__command][value='held_cuts.give_back'])");
await g.locator("input[name='tripIds[]']").first().waitFor();
assert.equal(await g.locator("input[name='tripIds[]']").count(), 1);
await g.locator("input[name^=give_]").fill("60");
await g.locator("select[name=transporterId]").selectOption({ label: "Masoud Transport" });
await g.locator("select[name=moneyAccountId]").selectOption({ label: "Main safe USD (USD)" });
await g.locator(submit).click();
await page.waitForTimeout(1200);

await page.hover("aside"); await page.click("button[aria-label='Sign out']");
await page.waitForURL(`${base}/en/login`);
await login("Finance Manager");
await page.goto(`${base}/en/approvals`);
// Approve this request (other flows, or an earlier run, may leave theirs waiting).
const waiting = await page.locator("text=Give back held cuts").count();
const mine = page.locator("tr, li, article, .card, .approval").filter({ hasText: "Give back held cuts" }).filter({ has: page.locator("form:has(input[name=requestId])") }).last();
await mine.locator("form:has(input[name=requestId])").first().locator(submit).click();
await page.waitForTimeout(1200);
await page.goto(`${base}/en/approvals`);
assert.equal(await page.locator("text=Give back held cuts").count(), waiting - 1, "the give-back was decided");
await page.hover("aside"); await page.click("button[aria-label='Sign out']");
await page.waitForURL(`${base}/en/login`);
await login("Admin");

// Done: the release shows 60 given back and 15 kept, and the trip has no cut held any more.
await page.goto(`${base}/en/claims/held?m=${M}`);
await page.waitForSelector("text=No held cuts match");
const rel = page.locator("tr:has-text('Masoud Transport'):has-text('Given back')").first();
assert.match(await rel.innerText(), /\$60[\s\S]*\$15/);

// Reverse it: the cut is held again.
await rel.locator("button.ghost:has-text('Reverse')").click();
f = dlg("held_cuts.reverse");
await f.locator("input[name=reason]").fill("wrong transporter");
await f.locator(submit).click();
await closed();
await page.goto(`${base}/en/claims/held?m=${M}`);
await page.waitForSelector(`td:has-text("${M}")`);

assert.deepEqual(errors, []);
console.log("e2e held cuts flow: OK");
await browser.close();
