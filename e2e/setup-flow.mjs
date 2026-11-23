// Setup screens: add a partner with two roles, change approval limits, add a document rule.
import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.env.BASE_URL ?? "http://localhost:3100";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
await page.goto(`${base}/en/login`);
await page.click("button:has-text('Admin')");
await page.waitForURL(`${base}/en`);
await page.click("a:has-text('Setup')");
await page.waitForURL(`${base}/en/setup`);

const submit = ".form-actions button >> nth=0";
await page.click("button:has-text('Add a partner')");
const pf = page.locator("dialog[open] form:has(input[name='roles[]'])");
await pf.locator("input[name=name]").fill("Kurdistan Haulage");
await pf.locator("input[value=transporter]").check();
await pf.locator("input[value=supplier]").check();
await pf.locator(submit).click();
await page.waitForSelector("td:has-text('Kurdistan Haulage')");
await page.waitForSelector("dialog[open]", { state: "detached" }).catch(() => {});
const roles = await page.locator("tr:has-text('Kurdistan Haulage')").innerText();
assert.match(roles, /Supplier/); assert.match(roles, /Transporter/);

await page.click("a:has-text('Limits & rounding')");
await page.waitForURL(/tab=settings/);
const lf = page.locator("form:has(input[name=__command][value='settings.payment_limits'])");
await lf.locator("input[name=v_USD]").fill("750");
await lf.locator("input[name=reason]").fill("tighter control");
await lf.locator(submit).click();
await lf.locator(".form-msg.ok").waitFor();
await page.reload();
assert.equal(await page.locator("form:has(input[name=__command][value='settings.payment_limits']) input[name=v_USD]").inputValue(), "750");

// A change without a reason is refused
const tf = page.locator("form:has(input[name=days])");
await tf.locator("input[name=days]").fill("5");
await tf.locator("input[name=reason]").evaluate((el) => el.removeAttribute("required"));
await tf.locator(submit).click();
await tf.locator(".form-msg.error").waitFor();

// A new cash box gets its own account in the books automatically (no ledger account to choose)
await page.goto(`${base}/en/setup?tab=accounting`);
await page.click("button:has-text('Add a cash box or bank account')");
const box = page.locator("dialog[open] form:has(input[name=__command][value='money_accounts.create'])");
await box.locator("input[name=name]").fill("Rekan Fars diesel");
await box.locator("select[name=currency]").selectOption("USD");
await box.locator(submit).click();
await page.waitForSelector("dialog[open]", { state: "detached" });
await page.reload();
assert.match(await page.locator("tr:has-text('Rekan Fars diesel')").first().innerText(), /10\d\d · Rekan Fars diesel/);

// An account typed by mistake is renamed, then deleted (nothing uses it); an account in use shows no Delete
await page.click("button:has-text('Add an account')");
const acc = page.locator("dialog[open] form:has(input[name=__command][value='ledger.create_account'])");
await acc.locator("input[name=name]").fill("Typed by mistake");
await acc.locator("select[name=type]").selectOption("asset");
await acc.locator(submit).click();
await page.waitForSelector("dialog[open]", { state: "detached" });
await page.reload();
const row = page.locator("tr:has-text('Typed by mistake')");
await row.locator("button:has-text('Edit')").click();
const ed = page.locator("dialog[open] form:has(input[name=__command][value='ledger.update_account'])");
await ed.locator("input[name=name]").fill("Typed by mistake (renamed)");
await ed.locator(submit).click();
await page.waitForSelector("dialog[open]", { state: "detached" });
await page.reload();
await page.locator("tr:has-text('Typed by mistake (renamed)') button:has-text('Delete')").click();
await page.waitForSelector("tr:has-text('Typed by mistake')", { state: "detached" });
assert.equal(await page.locator("tr:has-text('Rekan Fars diesel') button:has-text('Delete')").count(), 0, "an account used by a cash box cannot be deleted");

assert.deepEqual(errors, []);
console.log("e2e setup flow: OK");
await browser.close();
