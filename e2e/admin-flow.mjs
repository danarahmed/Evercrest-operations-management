// Users and roles through the UI.
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
const email = `ops${Date.now()}@evercrest.local`;

await page.goto(`${base}/en/admin`);
await page.click("button:has-text('Create or change a role')");
const role = page.locator("dialog[open] form:has(input[name='permissions[]'])");
await role.locator("input[name=code]").fill("ops");
await role.locator("input[name=name]").fill("Operations");
await role.locator("input[name=reason]").fill("new team");
for (const p of ["jobs.view", "jobs.create", "jobs.manage", "trips.manage"]) await role.locator(`input[value='${p}']`).check();
await role.locator(".form-actions button >> nth=0").click();
await page.waitForSelector(".tile-title:has-text('Operations')");
await page.waitForSelector("dialog[open]", { state: "detached", timeout: 3000 }).catch(() => {});

await page.click("button:has-text('Add a user')");
const u = page.locator("dialog[open] form:has(input[name=email])");
await u.locator("input[name=displayName]").fill("Hawre Operations");
await u.locator("input[name=email]").fill(email);
await u.locator(".form-actions button >> nth=0").click();
await page.waitForSelector("td:has-text('Hawre Operations')");
await page.waitForTimeout(500);

await page.click("button:has-text('Give or take a role')");
const a = page.locator("dialog[open] form:has(select[name=roleId])");
await a.locator("select[name=userId]").selectOption({ label: "Hawre Operations" });
await a.locator("select[name=roleId]").selectOption({ label: "Operations" });
await a.locator("input[name=reason]").fill("joined");
await a.locator(".form-actions button >> nth=0").click();
await page.waitForSelector("tr:has-text('Hawre Operations') .badge:text-is('Operations')");

await page.goto(`${base}/en/admin/audit?action=org`);
assert.match(await page.locator("table").innerText(), /org\.grant_role/);
assert.deepEqual(errors, []);
console.log("e2e admin flow: OK");
await browser.close();
