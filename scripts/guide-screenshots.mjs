// Screenshots for the owner's guide (docs/guide/img). Walks the whole step 1–2 flow on the dev seed.
// Usage: node scripts/guide-screenshots.mjs docs/guide/img <tmp dir>   (app on :3100, AUTH_MODE=dev, fresh seed)
import { chromium } from "playwright";
import ExcelJS from "exceljs";
import { mkdirSync } from "node:fs";

const out = process.argv[2];
const tmp = process.argv[3];
mkdirSync(out, { recursive: true });
const base = "http://localhost:3100";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1366, height: 820 } });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("dialog", (d) => d.accept());
const submit = ".form-actions button >> nth=0";
const today = new Date().toISOString().slice(0, 10);
const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const shot = async (name, opts = {}) => { await p.waitForTimeout(350); await p.screenshot({ path: `${out}/${name}.jpg`, type: "jpeg", quality: 82, ...opts }); console.log("shot", name); };
const closed = () => p.waitForSelector("dialog[open]", { state: "detached" });
const login = async (who, loc = "en") => {
  await p.goto(`${base}/${loc}/login`);
  await p.click(`button:has-text('${who}')`);
  await p.waitForURL(`${base}/${loc}`);
};
const logout = async () => { await p.hover("aside"); await p.click("button[aria-label='Sign out']"); await p.waitForURL(/\/login/); };

// ---------- Once: setup ----------
await login("Admin");
await shot("01-home");
await p.goto(`${base}/en/setup?tab=accounting`); await shot("02-setup-cash-boxes");
await p.goto(`${base}/en/setup?tab=settings`); await shot("03-setup-limits-rounding");
await p.goto(`${base}/en/setup?tab=operations`); await shot("04-setup-papers", { fullPage: true });
await p.goto(`${base}/en/admin`); await shot("05-users-roles");

// ---------- Step 1: job ----------
await p.goto(`${base}/en/jobs/new`);
await p.selectOption("select[name=customerId]", { label: "North Oil Co" });
await p.selectOption("select[name=jobTypeId]", { label: "Petroleum transportation" });
await p.fill("input[name=name]", "Diesel to Latakia, November");
await shot("06-new-job");
await p.click("button:has-text('Create job')");
await p.waitForURL(/\/en\/jobs\/[0-9a-f-]{36}$/);
const job = p.url();
await shot("07-job-overview");

// Rule card
await p.goto(`${job}?tab=rules`);
await shot("08-rules-empty");
await p.click("button:has-text('New version')");
const rf = p.locator("dialog[open] form:has(input[name=__command][value='job_terms.set'])");
await rf.locator("input[name=effectiveFrom]").fill(day(20));
await rf.locator("input[name=carrierPrice]").fill("70");
await rf.locator("input[name=rewardPerTrip]").fill("10");
await rf.locator("input[name=carrierAllowance]").fill("0.15");
await rf.locator("input[name=carrierFinePrice]").fill("1200");
await rf.locator("input[name=customerPrice]").fill("120");
if (await rf.locator("input[name=advanceNormal]").count()) await rf.locator("input[name=advanceNormal]").fill("500");
await rf.locator("input[name=advanceMax]").fill("900");
await shot("09-rules-new-version");
await rf.locator(submit).click(); await closed();
// route
await p.click("button:has-text('Add route')");
const routeForm = p.locator("dialog[open] form:has(input[name=__command][value='job_routes.define'])");
await routeForm.locator("input[name=name]").fill("Erbil – Latakia");
await routeForm.locator(submit).click(); await closed();
// a fee taken back from the carrier
await p.click("button:has-text('Set fee')");
const ff = p.locator("dialog[open] form:has(input[name=__command][value='job_fees.set'])");
const visa = await ff.locator("select[name=feeTypeId] option", { hasText: "Visa" }).first().getAttribute("value");
await ff.locator("select[name=feeTypeId]").selectOption(visa);
await ff.locator("input[name=effectiveFrom]").fill(day(20));
await ff.locator("input[name=amount]").fill("50");
if (await ff.locator("input[name=deductFromCarrier]").count()) await ff.locator("input[name=deductFromCarrier]").check();
await shot("10-rules-set-fee");
await ff.locator(submit).click(); await closed();
await p.goto(`${job}?tab=rules`);
await shot("11-rules-done", { fullPage: true });

// ---------- Trips ----------
await p.goto(`${job}?tab=trips`);
await shot("12-trips-empty");
// change the sticky values on the entry line
await p.click("details.entry-change > summary");
const pop = p.locator("details.entry-change .entry-pop");
await pop.locator("input[type=date]").fill(day(12));
await pop.locator("input[list=el-routes]").fill("Erbil – Latakia");
await pop.locator("input[list=el-transporters]").fill("Masoud Transport");
await pop.locator("label:has-text('Advance') input").fill("500");
await shot("13-entry-line-change");
await p.keyboard.press("Escape");
const line = p.locator("form.entry-line .entry-fields");
const trucks = [["Hemin Aziz", "22 C 32754", "H-401", "30.68"], ["Karwan Ali", "22 E 26642", "H-402", "30.4"], ["Aso Rahman", "22 C 32038", "H-403", "29.9"]];
for (const [i, [d, plate, man, qty]] of trucks.entries()) {
  await line.locator("input[list=el-drivers]").fill(d);
  await line.locator("label:has-text('Plate') input").fill(plate);
  await line.locator("label:has-text('Manifest') input").fill(man);
  await line.locator("input[inputmode=decimal]").fill(qty);
  if (i === 0) await shot("14-entry-line-typed");
  await line.locator("input[inputmode=decimal]").press("Enter");
  await p.waitForSelector(`table tbody tr:has-text('${man}')`);
}
await shot("15-trips-after-entry");

// one trip from the full form, direct with the driver
await p.click("a:has-text('New trip')");
let tf = p.locator("dialog[open] form:has(input[name=__command][value='trips.save'])");
await tf.locator("input[name=manifestNo]").fill("H-404");
await tf.locator("input[name=driverName]").fill("Dler Omer");
await tf.locator("input[name=plate]").fill("21 K 10337");
await tf.locator("input[name=loadingDate]").fill(day(11));
await tf.locator("input[name=loadedQty]").fill("30");
await shot("16-trip-dialog-new");
await tf.locator(submit).click(); await closed();

// import a loading sheet as the site keeps it
const loadBook = new ExcelJS.Workbook(); const ls = loadBook.addWorksheet("بارکردن");
ls.addRow(["بەرواری بارکردن", "محور", "ناقل", "ناو سایەق", "ژ. سەیارە", "رقم منفیست", "بڕی بارکراو", "سلف"]);
const loads = [["H-405", "Rebin Salih", "22 G 27900", 30.3, 500], ["H-406", "Shwan Kamal", "22 H 14090", 31.52, 500], ["H-407", "Hiwa Omar", "21 A 78624", 30.22, 0], ["H-408", "Sirwan Aziz", "22 J 27172", 30.12, 500]];
for (const [m, d, pl, q, adv] of loads) ls.addRow([day(10), "Erbil – Latakia", "Zagros Transport", d, pl, m, q, adv || null]);
const loadFile = `${tmp}/loading-sheet.xlsx`; await loadBook.xlsx.writeFile(loadFile);
await p.goto(`${job}?tab=trips`);
await p.click("button:has-text('Import sheet')");
await p.setInputFiles("dialog[open] input[type=file]", loadFile);
await shot("17-import-choose");
await p.click("dialog[open] button:has-text('Preview')"); await p.waitForURL(/\/import\//);
await p.selectOption("select[name=moneyAccountId]", { label: "Main safe USD (USD)" });
await shot("18-import-preview", { fullPage: true });
await p.click("button:has-text('Create and update')"); await p.waitForURL(/tab=trips/);
await shot("19-trips-after-import");

// discharge data comes back: re-import fills only discharge
const disBook = new ExcelJS.Workbook(); const ds = disBook.addWorksheet("بەتاڵکردن");
ds.addRow(["رقم منفیست", "بەرواری بەتاڵکردن", "بڕی بەتاڵکراو"]);
const dis = [["H-401", 30.68], ["H-402", 30.1], ["H-403", 29.9], ["H-405", 30.3], ["H-406", 29.3], ["H-407", 30.22], ["H-408", 30.0]];
for (const [m, q] of dis) ds.addRow([m, day(5), q]);
const disFile = `${tmp}/discharge-sheet.xlsx`; await disBook.xlsx.writeFile(disFile);
await p.click("button:has-text('Import sheet')");
await p.setInputFiles("dialog[open] input[type=file]", disFile);
await p.click("dialog[open] button:has-text('Preview')"); await p.waitForURL(/\/import\//);
await shot("20-import-discharge-preview", { fullPage: true });
await p.click("button:has-text('Create and update')"); await p.waitForURL(/tab=trips/);
await shot("21-trips-discharged");

// discharge by hand on one trip, and a correction with a reason
await p.click("a:has-text('H-404')"); await p.waitForSelector("dialog[open]");
tf = p.locator("dialog[open] form:has(input[name=__command][value='trips.save'])");
await tf.locator("input[name=dischargeDate]").fill(day(5));
await tf.locator("input[name=dischargedQty]").fill("30");
await tf.locator(submit).click(); await closed();
await p.goto(`${job}?tab=trips`);
await p.click("a:has-text('H-402')"); await p.waitForSelector("dialog[open]");
tf = p.locator("dialog[open] form:has(input[name=__command][value='trips.save'])");
await tf.locator("input[name=loadedQty]").fill("30.45");
await tf.locator("input[name=reason]").fill("manifest says 30.45");
await tf.locator(submit).click(); await closed();
await p.goto(`${job}?tab=trips`);
await p.click("a:has-text('H-402')"); await p.waitForSelector("dialog[open]");
await shot("22-trip-dialog-history");
await p.keyboard.press("Escape"); await p.waitForTimeout(300);

// grid tools: column filter, chips, columns
await p.goto(`${job}?tab=trips`);
await p.locator("th:has-text('Transporter') details.colfilter > summary").click();
await shot("23-column-filter");
await p.keyboard.press("Escape");
await p.goto(`${job}?tab=trips&chip=hasfine`);
await shot("24-chip-has-fine");
await p.goto(`${job}?tab=trips`);
await p.locator("details.colpicker > summary").click();
await shot("25-columns-panel");
await p.keyboard.press("Escape");

// ---------- Fine waiver ----------
await p.click("a:has-text('H-406')"); await p.waitForSelector("dialog[open]");
const wf = p.locator("dialog[open] form:has(input[name=__command][value='fines.waive'])");
await wf.locator("input[name=amount]").fill("1000");
await wf.locator("input[name=reason]").fill("Road closed at the border for 3 days; tank checked");
await wf.scrollIntoViewIfNeeded();
await shot("26-waiver-request");
await wf.locator(submit).click();
await wf.locator(".form-msg.error", { hasText: "Approval needed" }).waitFor();
await wf.locator("button:has-text('Send for approval')").click();
await p.waitForTimeout(800);
// the waiver holds the trip back from claims until a second person decides
await p.goto(`${job}?tab=claims&claimant=Zagros+Transport&m=H-406`);
await shot("26b-claim-waiver-pending");
await logout(); await login("Finance Manager");
await p.goto(`${base}/en/approvals`);
await shot("26c-approvals-waiver");
await p.locator("form:has(input[name=requestId])").first().locator(submit).click();
await p.waitForSelector("text=Nothing is waiting for approval.");
await logout(); await login("Admin");
await p.goto(`${job}?tab=trips`);
await p.click("a:has-text('H-406')"); await p.waitForSelector("dialog[open]");
await shot("26d-trip-waived");
await p.keyboard.press("Escape"); await p.waitForTimeout(300);

// ---------- Documents ----------
await p.goto(`${job}?tab=documents`);
await shot("27-documents-tab", { fullPage: true });

// ---------- Claims ----------
await p.goto(`${job}?tab=claims`);
await shot("28-claims-tab-empty");
await p.click("button:has-text('New claim')");
const nc = p.locator("dialog[open] form");
await nc.locator("input[name=claimant]").fill("Zagros Transport");
await nc.locator("textarea[name=m]").fill("H-401\nH-402\nH-403\nH-406\nH-999");
await shot("29-new-claim");
await nc.locator("button:has-text('Check the manifests')").click();
await p.waitForSelector("text=Check: 5 manifests");
await shot("30-claim-check", { fullPage: true });
await p.click("button:has-text('Claim only the')");
await p.waitForSelector("form:has(input[name=__command][value='claims.create'])");
await shot("31-claim-ready", { fullPage: true });
await p.locator("form:has(input[name=__command][value='claims.create'])").locator(submit).click();
await p.waitForURL(/\/en\/claims\/[0-9a-f-]{36}$/);
const claimUrl = p.url();
await shot("32-claim-page", { fullPage: true });
await p.click("button:has-text('Pay')");
let pay = p.locator("dialog[open] form:has(input[name=__command][value='claims.pay'])");
await pay.locator("input[name=amount]").fill("700");
await pay.locator("select[name=moneyAccountId]").selectOption({ label: "Main safe USD (USD)" });
await shot("33-claim-pay");
await pay.locator(submit).click(); await closed();
await p.goto(claimUrl);
await shot("34-claim-part-paid", { fullPage: true });
await p.click("button:has-text('Pay')");
pay = p.locator("dialog[open] form:has(input[name=__command][value='claims.pay'])");
await pay.locator("select[name=moneyAccountId]").selectOption({ label: "Main safe USD (USD)" });
await pay.locator(submit).click();
await pay.locator(".form-msg.error", { hasText: "Approval needed" }).waitFor();
await shot("35-pay-needs-approval");
await pay.locator("button:has-text('Send for approval')").click();
await p.waitForTimeout(800);

// ---------- Site settlement ----------
const siteBook = new ExcelJS.Workbook(); const ss = siteBook.addWorksheet("حیساب");
ss.addRow(["رقم المنفيست", "اسم السائق", "المدفوع"]);
ss.addRow(["H-405", "Rebin Salih", 1640]); ss.addRow(["H-407", "Hiwa Omar", 2125]); ss.addRow(["H-408", "Sirwan", 1600]); ss.addRow(["H-401", "Hemin", 1700]); ss.addRow(["H-777", "?", 500]);
const siteFile = `${tmp}/site-settlement.xlsx`; await siteBook.xlsx.writeFile(siteFile);
await p.goto(`${job}?tab=claims`);
await p.click("button:has-text('Import a site settlement')");
await p.setInputFiles("dialog[open] input[type=file]", siteFile);
await p.selectOption("dialog[open] select[name=moneyAccountId]", { label: "Main safe USD (USD)" });
await shot("36-site-upload");
await p.click("dialog[open] button:has-text('Compare')"); await p.waitForURL(/\/remote\//);
const remoteUrl = p.url();
await shot("37-site-compare", { fullPage: true });
const ap = p.locator("form:has(input[name=__command][value='remote_settlements.approve'])");
await ap.locator(submit).click();
await ap.locator(".form-msg.error", { hasText: "Approval needed" }).waitFor();
await ap.locator("button:has-text('Send for approval')").click();
await p.waitForTimeout(800);

// ---------- Approvals by a second person ----------
await logout();
await login("Finance Manager");
await p.goto(`${base}/en/approvals`);
await shot("38-approvals", { fullPage: true });
for (let i = 0; i < 3; i++) {
  const forms = p.locator("form:has(input[name=requestId])");
  if (!(await forms.count())) break;
  await forms.first().locator(submit).click();
  await p.waitForTimeout(1200);
  await p.goto(`${base}/en/approvals`);
}
await p.goto(remoteUrl);
await shot("39-site-approved", { fullPage: true });
await logout();
await login("Admin");

// after approvals
await p.goto(claimUrl); await shot("40-claim-paid", { fullPage: true });
await p.goto(`${job}?tab=trips`);
await p.click("a:has-text('H-401')"); await p.waitForSelector("dialog[open]");
await shot("42-trip-claimed-locked");
await p.keyboard.press("Escape"); await p.waitForTimeout(300);
await p.goto(`${job}?tab=claims`); await shot("43-claims-tab-full", { fullPage: true });

// ---------- Where to find things ----------
await p.goto(`${base}/en/claims`); await shot("44-claims-page");
await p.goto(`${base}/en/trips`); await shot("45-trips-page");
await p.goto(`${base}/en/finance/partners`); await shot("46-partner-accounts");
await p.goto(claimUrl); await p.click("h1 a.title-link"); await p.waitForURL(/finance\/partners\//); await shot("47-carrier-account", { fullPage: true });
await p.goto(`${base}/en/finance/journal`); await shot("48-journal");
await p.goto(`${base}/en/finance/accounts`); await shot("49-cash-books");
await p.goto(`${job}`); await shot("50-job-overview-after");

// ---------- Languages ----------
await p.goto(claimUrl.replace("/en/", "/ckb/")); await shot("51-claim-kurdish", { fullPage: true });
await p.goto(`${job.replace("/en/", "/ar/")}?tab=trips`); await shot("52-trips-arabic");

if (errors.length) console.log("page errors:", errors);
await b.close();
