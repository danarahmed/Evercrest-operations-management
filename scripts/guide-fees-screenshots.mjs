// Pictures for the guide's "Fees the driver paid" and "Fees on the customer's invoice" sections (docs/guide/img/f-*.jpg).
// Usage: node scripts/guide-fees-screenshots.mjs docs/guide/img   (app on :3100, AUTH_MODE=dev, fresh dev seed)
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
const today = new Date().toISOString().slice(0, 10);

await p.goto(`${base}/en/login`); await p.click("button:has-text('Admin')"); await p.waitForURL(`${base}/en`);
await p.goto(`${base}/en/jobs`);
const job = `${base}${await p.locator("a:has-text('Diesel to Field X')").first().getAttribute("href")}`;

// The job's rule card: visa and insurance on the customer's invoice from today
await p.goto(`${job}?tab=rules`);
await p.click("button:has-text('Change from a date')"); await p.waitForSelector("dialog[open]");
const bf = p.locator("dialog[open] form:has(input[name=__command][value='job_billed_fees.set'])");
await bf.locator("input[name=effectiveFrom]").fill(today);
await bf.locator("label.check:has-text('Visa') input").check();
await bf.locator("label.check:has-text('Insurance') input").check();
await bf.locator("input[name=note]").fill("North Oil pays visa and insurance back");
await shot("f-01-invoice-fees-change");
await bf.locator(submit).click(); await closed();
await p.evaluate(() => { const h = [...document.querySelectorAll(".card-title")].find((e) => e.textContent.includes("customer's invoice")); window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 110); });
await shot("f-02-invoice-fees-card");

// Two trips: the visa paid by the driver; on the first the insurance too
for (const [i, man] of ["V-801", "V-802"].entries()) {
  await p.goto(`${job}?tab=trips`);
  await p.click("a:has-text('New trip')");
  const f = p.locator("dialog[open] form:has(input[name=__command][value='trips.save'])");
  await f.locator("input[name=manifestNo]").fill(man);
  await f.locator("input[name=driverName]").fill(i ? "Kosrat Ali" : "Sardar Hama");
  await f.locator("input[name=transporterName]").fill("Masoud Transport");
  await f.locator("input[name=plate]").fill(i ? "22 V 80802" : "22 V 80801");
  await f.locator("input[name=loadingDate]").fill(today);
  await f.locator("input[name=loadedQty]").fill("30");
  await f.locator("input[name=dischargeDate]").fill(today);
  await f.locator("input[name=dischargedQty]").fill("30");
  const visa = f.locator(".fee-row:has-text('Visa')");
  await visa.locator("input[name^=fee_]").check();
  await visa.locator("select[name^=feePaidBy_]").selectOption("carrier");
  if (i === 0) {
    const ins = f.locator(".fee-row:has-text('Insurance')");
    await ins.locator("input[name^=fee_]").check();
    await ins.locator("select[name^=feePaidBy_]").selectOption("carrier");
    await f.locator(".fee-rows").scrollIntoViewIfNeeded();
    await shot("f-03-trip-driver-paid");
  }
  await f.locator(submit).click(); await closed();
}
await p.goto(`${job}?tab=trips`); await p.click("a:has-text('V-801')"); await p.waitForSelector("dialog[open]");
await p.locator("dialog[open] .card-title:has-text('As calculated')").scrollIntoViewIfNeeded().catch(() => {});
await shot("f-04-trip-figures");
// The receipt of V-802's visa is lost: an exception for approval
await p.goto(`${job}?tab=trips`); await p.click("a:has-text('V-802')"); await p.waitForSelector("dialog[open]");
const nr = p.locator("dialog[open] form:has(input[name=__command][value='trip_fees.receipt_waive'])");
await nr.locator("input[name=reason]").fill("Receipt lost; the border office confirms the payment");
await nr.scrollIntoViewIfNeeded();
await shot("f-05-pay-without-receipt");
await p.keyboard.press("Escape"); await p.waitForTimeout(300);

// The claim: refused without the receipts, ready when they come with it
await p.goto(`${job}?tab=claims`);
await p.click("button:has-text('New claim')");
let nc = p.locator("dialog[open] form");
await nc.locator("input[name=claimant]").fill("Zagros Transport");
await nc.locator("textarea[name=m]").fill("V-801");
await nc.locator("button:has-text('Check the manifests')").click(); await p.waitForSelector("text=Check: 1 manifest");
await shot("f-06-claim-receipt-missing");
await p.click("a:has-text('Start over')");
await p.click("button:has-text('New claim')");
nc = p.locator("dialog[open] form");
await nc.locator("input[name=claimant]").fill("Zagros Transport");
await nc.locator("textarea[name=m]").fill("V-801");
await nc.locator("input[name=rc]").check();
await shot("f-07-claim-receipts-came");
await nc.locator("button:has-text('Check the manifests')").click(); await p.waitForSelector("text=Check: 1 manifest");
await p.locator("form:has(input[name=__command][value='claims.create'])").locator(submit).click();
await p.waitForURL(/\/en\/claims\/[0-9a-f-]{36}$/);
await shot("f-08-claim-books", { fullPage: true });
await p.goto(`${job}?tab=trips`); await shot("f-09-trips-to-bill");

if (errors.length) console.log("page errors:", errors);
await b.close();
