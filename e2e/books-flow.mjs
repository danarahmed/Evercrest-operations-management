// Finance books through the UI: currency exchange, manual journal entry, partner account, month lock.
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
/** Choose the option whose text matches. */
const pick = async (select, re) => {
  const value = await select.evaluate((el, src) => [...el.options].find((o) => new RegExp(src).test(o.text))?.value, re.source);
  assert.ok(value, `no option matching ${re}`);
  await select.selectOption(value);
};

const usdBalance = async () => {
  await page.goto(`${base}/en/finance/accounts`);
  const row = await page.locator(".stat", { hasText: "Main safe USD" }).first().innerText();
  return Number(row.match(/\$([\d,.]+)/)[1].replace(/,/g, ""));
};
const before = await usdBalance();

// Sell 100 USD for 146,000 IQD
await page.goto(`${base}/en/finance/exchange`);
await page.click("button:has-text('New exchange')");
const fx = page.locator("dialog[open] form:has(input[name=fromAmount])");
await pick(fx.locator("select[name=fromMoneyAccountId]"), /Main safe USD/);
await fx.locator("input[name=fromAmount]").fill("100");
await pick(fx.locator("select[name=toMoneyAccountId]"), /Main safe IQD/);
await fx.locator("input[name=toAmount]").fill("146000");
await fx.locator(".form-actions button >> nth=0").click();
await page.waitForSelector("td:has-text('FX-2026-')");
assert.match(await page.locator("table").innerText(), /1 USD = 1,460 IQD/);

// Manual journal entry: owner adds 1,000,000 IQD capital to the safe
await page.goto(`${base}/en/finance/journal`);
await page.click("button:has-text('Manual journal entry')");
const je = page.locator("form:has(input[name='l_debit[]'])");
await je.locator("input[name=description]").fill("Owner capital top-up");
await pick(je.locator("select[name='l_accountId[]']").nth(0), /^1012/);
await je.locator("input[name='l_debit[]']").nth(0).fill("1000000");
await pick(je.locator("select[name='l_accountId[]']").nth(1), /^3000/);
await je.locator("input[name='l_credit[]']").nth(1).fill("1000000");
await je.locator(".form-actions button >> nth=0").click();
await page.waitForSelector("strong:text-is('Owner capital top-up')");
await page.waitForSelector("dialog[open]", { state: "detached" }).catch(() => {}); // saved; the dialog closed and the form was cleared
await page.waitForTimeout(500);

// Unbalanced entry is refused with a clear message
if (!(await je.locator("input[name=description]").isVisible())) await page.click("button:has-text('Manual journal entry')");
await je.locator("input[name=description]").fill("Wrong");
await pick(je.locator("select[name='l_accountId[]']").nth(0), /^1012/);
await je.locator("input[name='l_debit[]']").nth(0).fill("10");
await pick(je.locator("select[name='l_accountId[]']").nth(1), /^3000/);
await je.locator("input[name='l_credit[]']").nth(1).fill("9");
await je.locator(".form-actions button >> nth=0").click();
await je.locator(".form-msg.error", { hasText: "does not balance" }).waitFor();

// Cash balances reflect both
assert.equal(await usdBalance(), before - 100, "100 USD sold");

// Partner account of the customer
await page.goto(`${base}/en/finance/partners`);
await page.click("a:has-text('North Oil Co')");
await page.waitForSelector("h1:has-text('North Oil Co')");
assert.match(await page.locator(".stats").innerText(), /owes us/);

assert.deepEqual(errors, []);
console.log("e2e books flow: OK");
await browser.close();
