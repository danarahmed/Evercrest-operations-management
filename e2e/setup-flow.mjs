// Setup screens: add a partner with two roles, change approval limits, add a document rule.
import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.env.BASE_URL ?? "http://localhost:3100";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
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

assert.deepEqual(errors, []);
console.log("e2e setup flow: OK");
await browser.close();
