// Finance screens: invoice a customer, receive part of it, see outstanding and P&L.
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
await page.click("a:has-text('Finance')");
await page.waitForURL(`${base}/en/finance`);

await page.click("summary:has-text('New invoice or bill')");
const inv = page.locator("form:has(input[name='l_description[]'])");
await inv.locator("select[name=partnerId]").selectOption({ label: "North Oil Co" });
await inv.locator("input[name=dueDate]").fill("2099-12-31");
await inv.locator("input[name='l_description[]']").first().fill("Diesel transport, 10 MT");
await inv.locator("input[name='l_quantity[]']").first().fill("10");
await inv.locator("input[name='l_unitPrice[]']").first().fill("100");
await inv.locator("select[name='l_accountId[]']").first().selectOption({ label: "4000 · Transport revenue" });
await inv.locator("button.primary").click();
await page.waitForSelector("text=Saved.");
await page.reload();
const row = page.locator("tr:has-text('2099-12-31')");
assert.match(await row.innerText(), /\$1,000/);

await page.click("summary:has-text('Record a payment')");
const pay = page.locator("form:has(select[name=invoiceId])");
const invText = (await row.locator("td").first().innerText()).trim();
const opt = await pay.locator(`select[name=invoiceId] option:has-text('${invText}')`).getAttribute("value");
await pay.locator("select[name=invoiceId]").selectOption(opt);
await pay.locator("select[name=moneyAccountId]").selectOption({ label: "Main safe USD (USD)" });
await pay.locator("input[name=amount]").fill("400");
await pay.locator("button.primary").click();
await page.waitForSelector("text=Saved.");
await page.reload();
assert.match(await page.locator("tr:has-text('2099-12-31')").innerText(), /\$600/);

// Overpayment is refused with a clear message
await page.click("summary:has-text('Record a payment')");
await pay.locator("select[name=invoiceId]").selectOption(opt);
await pay.locator("select[name=moneyAccountId]").selectOption({ label: "Main safe USD (USD)" });
await pay.locator("input[name=amount]").fill("5000");
await pay.locator("button.primary").click();
await page.waitForSelector("text=exceeds the outstanding");

assert.match(await page.locator("h3:has-text('Profit and loss') + div").innerText(), /Net profit/);
assert.deepEqual(errors, []);
console.log("e2e finance flow: OK");
await browser.close();
