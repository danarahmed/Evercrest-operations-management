// Screenshots for the guide's "Jobs and documents" setup section (docs/guide/img/s-*.jpg).
// Usage: node scripts/guide-setup-screenshots.mjs docs/guide/img   (app on :3100, AUTH_MODE=dev, fresh dev seed)
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
const shot = async (name, target) => { await p.waitForTimeout(350); await (target ?? p).screenshot({ path: `${out}/${name}.jpg`, type: "jpeg", quality: 82 }); console.log("shot", name); };
const dlg = () => p.locator("dialog[open]");
const open = async (label) => { await p.locator(`button:has-text("${label}")`).first().click(); await dlg().waitFor(); };
const save = async () => { await dlg().locator(".form-actions button").first().click(); await p.waitForSelector("dialog[open]", { state: "detached" }); await p.waitForLoadState("networkidle"); };
const tab = `${base}/en/setup?tab=operations`;

await p.goto(`${base}/en/login`);
await p.click("button:has-text('Admin')");
await p.waitForURL(`${base}/en`);

// The tab as it opens.
await p.goto(tab);
await shot("s-01-jobs-documents-tab", p);

// 1. Job types: add one (filled, as an example), and edit an existing one.
await open("Add a job type");
await dlg().locator("input[name=name]").fill("Petroleum transportation");
for (const v of ["transportation", "advances", "documents", "billing", "expenses"]) await dlg().locator(`input[value=${v}]`).check();
await dlg().locator("textarea[name=activitiesText]").fill("Arrange trucks\nLoad at depot\nDeliver to field\nCollect manifests\nInvoice customer");
await shot("s-02-add-job-type", dlg());
await dlg().locator("button[aria-label=Close]").click();
await p.locator(".tile", { hasText: "Petroleum transportation" }).locator("button:has-text('Edit')").click();
await dlg().waitFor();
await shot("s-03-edit-job-type", dlg());
await dlg().locator("button[aria-label=Close]").click();

// 2. Documents: a new document type, then a rule that requires it.
await open("Add a document type");
await dlg().locator("input[name=name]").fill("Discharge certificate");
await shot("s-04-add-document-type", dlg());
await save();
await p.goto(tab);
await open("Require a document");
await dlg().locator("select[name=documentTypeId]").selectOption({ label: "Discharge certificate" });
await dlg().locator("select[name=target]").selectOption({ label: "North Oil Co" });
await dlg().locator("select[name=appliesTo]").selectOption("trip");
await dlg().locator("select[name=requiredBefore]").selectOption("financially_closed");
await dlg().locator("input[name=reason]").fill("North Oil Co asks for a discharge certificate with every invoice");
await shot("s-05-require-document", dlg());
await save();

// 3. Custom fields.
await p.goto(tab);
await open("Add or change a custom field");
await dlg().locator("input[name=label]").fill("Field permit no.");
await dlg().locator("input[name=key]").fill("permit_no");
await dlg().locator("select[name=target]").selectOption({ label: "Field service" });
await dlg().locator("input[name=required]").check();
await shot("s-06-add-custom-field", dlg());
await save();

// 4. Contracts.
await p.goto(tab);
await open("Add a contract");
await dlg().locator("select[name=partnerId]").selectOption({ label: "North Oil Co" });
await dlg().locator("input[name=reference]").fill("NOC-2026-14");
await dlg().locator("input[name=title]").fill("Diesel haulage to Field X, 2026");
await dlg().locator("input[name=validFrom]").fill("2026-01-01");
await dlg().locator("input[name=validTo]").fill("2026-12-31");
await dlg().locator("input[name=paymentTermsDays]").fill("30");
await dlg().locator("textarea[name=notes]").fill("Prices per job on the rule card; invoice monthly");
await shot("s-07-add-contract", dlg());
await save();
// Its files: the signed contract and amendments.
await p.locator("tr:has-text('NOC-2026-14') button:has-text('Attach')").first().click(); await dlg().waitFor();
await shot("s-07b-contract-files", dlg());
await p.keyboard.press("Escape"); await p.waitForTimeout(300);

// 5. Projects.
await p.goto(tab);
await open("Add a project");
await dlg().locator("select[name=customerId]").selectOption({ label: "North Oil Co" });
await dlg().locator("input[name=name]").fill("Field X supply 2026");
await dlg().locator("select[name=contractId]").selectOption({ index: 1 });
await shot("s-08-add-project", dlg());
await save();

// The tab after setting everything up.
await p.goto(tab);
await shot("s-09-jobs-documents-filled", p);
await p.screenshot({ path: `${out}/s-09-jobs-documents-filled-full.jpg`, type: "jpeg", quality: 82, fullPage: true });

// Where they show up: the new job form (project and contract), and a job's extra information (custom field).
await p.goto(`${base}/en/jobs/new`);
await p.waitForTimeout(300);
const more = p.locator("details summary").first();
if (await more.count()) await more.click();
await shot("s-10-new-job-project-contract", p);
await p.goto(`${base}/en/jobs`);
const fieldJob = await p.locator("a:has-text('Pump maintenance')").first().getAttribute("href");
await p.goto(`${base}${fieldJob}`);
await open("Extra info & budget");
await shot("s-11-job-custom-field", dlg());
await dlg().locator("button[aria-label=Close]").click();
await shot("s-12-job-blocked-by-field", p);

await b.close();
if (errors.length) { console.log("page errors:", errors); process.exit(1); }
console.log("setup screenshots: OK");
