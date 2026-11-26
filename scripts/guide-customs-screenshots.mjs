// Pictures for the guide's "Customs" section (docs/guide/img/cs-*.jpg).
// Usage: node scripts/guide-customs-screenshots.mjs docs/guide/img <tmp dir>   (app on :3100, AUTH_MODE=dev, fresh dev seed)
import { chromium } from "playwright";
import ExcelJS from "exceljs";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? "docs/guide/img";
const tmp = process.argv[3] ?? "/tmp";
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
const dlg = (cmd) => p.locator(`dialog[open] form:has(input[name=__command][value='${cmd}'])`);
const today = new Date().toISOString().slice(0, 10);

await p.goto(`${base}/en/login`); await p.click("button:has-text('Admin')"); await p.waitForURL(`${base}/en`);
// A clean job for the pictures: the customer price 120 and the carrier price 70 per MT.
await p.goto(`${base}/en/jobs/new`);
await p.selectOption("select[name=customerId]", { label: "North Oil Co" });
await p.selectOption("select[name=jobTypeId]", { label: "Petroleum transportation" });
await p.fill("input[name=name]", "Diesel to Latakia, December");
await p.click("button:has-text('Create job')");
await p.waitForURL(/\/en\/jobs\/[0-9a-f-]{36}$/);
const job = p.url();
await p.goto(`${job}?tab=rules`);
await p.click("button:has-text('New version')");
const rf = p.locator("dialog[open] form:has(input[name=__command][value='job_terms.set'])");
await rf.locator("input[name=effectiveFrom]").fill("2026-01-01");
await rf.locator("input[name=carrierPrice]").fill("70");
await rf.locator("input[name=customerPrice]").fill("120");
await rf.locator(".form-actions button").first().click(); await p.waitForSelector("dialog[open]", { state: "detached" });

await p.goto(`${job}?tab=customs`); await shot("cs-01-customs-empty");
await p.click("button:has-text('Set the customs rate')");
let f = dlg("customs_rates.set");
await f.locator("input[name=effectiveFrom]").fill("2026-01-01");
await f.locator("input[name=rate]").fill("9");
await shot("cs-02-set-rate");
await f.locator(submit).click(); await closed();
await p.click("button:has-text('Agent and who pays')");
f = dlg("job_customs.set");
await f.locator("input[name=agentName]").fill("Kak Aras");
await shot("cs-03-agent");
await f.locator(submit).click(); await closed();

// Three trucks; customs counted 31 MT on the second
for (const [i, [man, qty]] of [["C-901", ""], ["C-902", "31"], ["C-903", ""]].entries()) {
  await p.goto(`${job}?tab=trips`);
  await p.click("a:has-text('New trip')");
  f = dlg("trips.save");
  await f.locator("input[name=manifestNo]").fill(man);
  await f.locator("input[name=driverName]").fill(["Ari Mahmood", "Bestun Kareem", "Dana Faraj"][i]);
  await f.locator("input[name=transporterName]").fill("Zagros Transport");
  await f.locator("input[name=plate]").fill(`22 G 9090${i}`);
  await f.locator("input[name=loadingDate]").fill(today);
  await f.locator("input[name=loadedQty]").fill("30");
  await f.locator("input[name=dischargeDate]").fill(today);
  await f.locator("input[name=dischargedQty]").fill("30");
  if (qty) { await f.locator("input[name=customsQty]").fill(qty); await f.locator("input[name=customsQty]").scrollIntoViewIfNeeded(); await shot("cs-04-trip-customs-mt"); }
  await f.locator(submit).click(); await closed();
}
await p.goto(`${job}?tab=trips`); await shot("cs-05-trips-customs-column");

await p.goto(`${job}?tab=customs`);
await p.click("button:has-text('Pay the customs agent')");
f = dlg("customs.pay_agent");
await f.locator("input[name=amount]").fill("700");
await f.locator("select[name=moneyAccountId]").selectOption({ label: "Main safe USD (USD)" });
await f.locator("input[name=reference]").fill("First payment for the November trucks");
await shot("cs-06-pay-agent");
await f.locator(submit).click(); await closed();
await p.goto(`${job}?tab=customs`); await shot("cs-07-before-booking", { fullPage: true });
await p.click("button:has-text('Book customs')"); await p.waitForSelector("dialog[open]");
await shot("cs-08-book");
await dlg("customs.book").locator(submit).click(); await closed();
await p.goto(`${job}?tab=customs`); await shot("cs-09-after-booking", { fullPage: true });

// The agent's statement: C-901 30 (match), C-902 31 (match), C-903 30.5 (differs), and one he cleared for another job
const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("گومرگ");
ws.addRow(["رقم المنفيست", "ژ. سەیارە", "بڕی گومرگ"]);
ws.addRow(["C-901", "22 G 90900", 30]); ws.addRow(["C-902", "22 G 90901", 31]); ws.addRow(["C-903", "22 G 90902", 30.5]); ws.addRow(["X-111", "21 A 11111", 30]);
await wb.xlsx.writeFile(`${tmp}/aras-statement.xlsx`);
await p.click("button:has-text('Import the agent')");
await p.setInputFiles("dialog[open] input[type=file]", `${tmp}/aras-statement.xlsx`);
await shot("cs-10-import-statement");
await p.click("dialog[open] button:has-text('Compare')"); await p.waitForURL(/\/customs\/[0-9a-f-]{36}$/);
await shot("cs-11-compare", { fullPage: true });

// Claim the three trucks so the job's profit shows carriers and customs on their own lines
await p.goto(`${job}?tab=claims`);
await p.click("button:has-text('New claim')");
const nc = p.locator("dialog[open] form");
await nc.locator("input[name=claimant]").fill("Zagros Transport");
await nc.locator("textarea[name=m]").fill("C-901\nC-902\nC-903");
await nc.locator("button:has-text('Check the manifests')").click(); await p.waitForSelector("text=Check: 3 manifests");
await p.locator("form:has(input[name=__command][value='claims.create'])").locator(submit).click();
await p.waitForURL(/\/en\/claims\/[0-9a-f-]{36}$/);
await p.goto(job);
await p.evaluate(() => { const h = [...document.querySelectorAll(".card-title")].find((e) => /Profit/.test(e.textContent)); if (h) window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 110); });
await shot("cs-12-profit-breakdown");
await p.goto(`${job.replace("/en/", "/ar/")}?tab=customs`); await shot("cs-13-customs-arabic", { fullPage: true });

if (errors.length) console.log("page errors:", errors);
await b.close();
