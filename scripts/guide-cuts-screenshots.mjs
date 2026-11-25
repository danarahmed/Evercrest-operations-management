// Pictures for the guide's "Cuts held for transporters" and "Deductions kept by the company" sections (docs/guide/img/c-*.jpg).
// Usage: node scripts/guide-cuts-screenshots.mjs docs/guide/img   (app on :3100, AUTH_MODE=dev, fresh dev seed)
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? "docs/guide/img";
mkdirSync(out, { recursive: true });
const base = "http://localhost:3100";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1366, height: 820 } });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("dialog", (d) => d.accept());
const submit = ".form-actions button >> nth=0";
const shot = async (name, opts = {}) => { await p.waitForTimeout(350); await p.screenshot({ path: `${out}/${name}.jpg`, type: "jpeg", quality: 82, ...opts }); console.log("shot", name); };
const closed = () => p.waitForSelector("dialog[open]", { state: "detached" });
const toCard = (title) => p.evaluate((t) => { const h = [...document.querySelectorAll(".card-title")].find((e) => e.textContent.includes(t)); window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 110); }, title);
const login = async (who) => { await p.goto(`${base}/en/login`); await p.click(`button:has-text('${who}')`); await p.waitForURL(`${base}/en`); };
const logout = async () => { await p.hover("aside"); await p.click("button[aria-label='Sign out']"); await p.waitForURL(/\/login/); };
const today = new Date().toISOString().slice(0, 10);

await login("Admin");
// Setup: kinds of deduction
await p.goto(`${base}/en/setup?tab=accounting`);
await toCard("Kinds of deduction"); await shot("c-01-setup-deductions");
await p.click("button:has-text('Add a kind of deduction')"); await p.waitForSelector("dialog[open]");
await p.fill("dialog[open] input[name=name]", "Late papers");
await p.fill("dialog[open] input[name=defaultAmount]", "10");
await shot("c-02-add-deduction-kind");
await p.locator("dialog[open] form .form-actions button").first().click(); await closed();

// Two trips with a cut held for the transporter; the first also has the claim handling deduction ticked.
await p.goto(`${base}/en/jobs`);
const job = `${base}${await p.locator("a:has-text('Diesel to Field X')").first().getAttribute("href")}`;
for (const [i, man] of ["K-701", "K-702"].entries()) {
  await p.goto(`${job}?tab=trips`);
  await p.click("a:has-text('New trip')");
  const f = p.locator("dialog[open] form:has(input[name=__command][value='trips.save'])");
  await f.locator("input[name=manifestNo]").fill(man);
  await f.locator("input[name=driverName]").fill(i ? "Rebaz Hasan" : "Nawzad Omer");
  await f.locator("input[name=transporterName]").fill("Masoud Transport");
  await f.locator("input[name=plate]").fill(i ? "22 K 70702" : "22 K 70701");
  await f.locator("input[name=loadingDate]").fill(today);
  await f.locator("input[name=loadedQty]").fill("30");
  await f.locator("input[name=dischargeDate]").fill(today);
  await f.locator("input[name=dischargedQty]").fill("30");
  await f.locator("input[name=transporterCut]").fill("75");
  if (i === 0) {
    await f.locator("input[name=transporterCut]").scrollIntoViewIfNeeded();
    await shot("c-03-trip-cut");
    await f.locator("label.check:has-text('Claim handling') input[type=checkbox]").check();
    await f.locator("fieldset:has(input[name=dedShown])").scrollIntoViewIfNeeded();
    await shot("c-04-trip-deduction");
  }
  await f.locator(submit).click(); await closed();
}

// Zagros brings both manifests
await p.goto(`${job}?tab=claims`);
await p.click("button:has-text('New claim')");
const nc = p.locator("dialog[open] form");
await nc.locator("input[name=claimant]").fill("Zagros Transport");
await nc.locator("textarea[name=m]").fill("K-701\nK-702");
await nc.locator("button:has-text('Check the manifests')").click();
await p.waitForSelector("text=Check: 2 manifests");
await p.locator("form:has(input[name=__command][value='claims.create'])").locator(submit).click();
await p.waitForURL(/\/en\/claims\/[0-9a-f-]{36}$/);
await shot("c-05-claim-page", { fullPage: true });

// Held cuts: the list, then Masoud asks for K-701: 60 given back in cash, 15 kept
await p.goto(`${base}/en/claims`); await shot("c-06-claims-held-button");
await p.goto(`${base}/en/claims/held`); await shot("c-07-held-list", { fullPage: true });
await p.goto(`${base}/en/claims/held?do=give&m=K-701`);
const g = p.locator("form:has(input[name=__command][value='held_cuts.give_back'])");
await g.locator("input[name^=give_]").fill("60");
await g.locator("select[name=transporterId]").selectOption({ label: "Masoud Transport" });
await g.locator("select[name=moneyAccountId]").selectOption({ label: "Main safe USD (USD)" });
await shot("c-08-give-back", { fullPage: true });
await g.locator(submit).click(); await p.waitForTimeout(1200);
// Close K-702 into income (normally only after a long time; shown here with the close form)
await p.goto(`${base}/en/claims/held?do=close&m=K-702`);
await p.fill("form:has(input[name=__command][value='held_cuts.close']) input[name=reason]", "Not asked for in more than a year");
await shot("c-09-close-old", { fullPage: true });

await logout(); await login("Finance Manager");
await p.goto(`${base}/en/approvals`); await shot("c-10-approvals", { fullPage: true });
const mine = p.locator("tr, li, article, .card, .approval").filter({ hasText: "Give back held cuts" }).filter({ has: p.locator("form:has(input[name=requestId])") }).last();
await mine.locator("form:has(input[name=requestId])").first().locator(submit).click(); await p.waitForTimeout(1200);
await logout(); await login("Admin");
await p.goto(`${base}/en/claims/held`); await shot("c-11-after-give-back", { fullPage: true });
await p.goto(`${base}/en/finance/journal`); await shot("c-12-journal");
await p.goto(`${base}/ar/claims/held`); await shot("c-13-held-arabic", { fullPage: true });

if (errors.length) console.log("page errors:", errors);
await b.close();
