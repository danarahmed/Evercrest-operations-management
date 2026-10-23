// First-run setup in the browser (/en/welcome) on an empty, migrated database.
// Needs the app in Supabase mode with SETUP_TOKEN set and the stand-in from e2e/support/auth-mock.mjs:
//   SETUP_TOKEN=test-setup-token-0123456789abcdef NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 ... npx next start -p 3300
//   BASE_URL=http://localhost:3300 node e2e/first-run-setup.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";
const base = process.env.BASE_URL ?? "http://localhost:3300";
const mock = process.env.MOCK_URL ?? "http://localhost:54321";
const step = (s) => console.log("step:", s);
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const fill = async (code) => {
  await p.fill("input[name=code]", code);
  await p.fill("input[name=companyName]", "Evercrest");
  await p.fill("input[name=adminName]", "Danar Ahmed");
  await p.fill("input[name=adminEmail]", "Owner@Evercrestco.com");
  await p.selectOption("select[name=adminLocale]", "ckb");
  await p.click("button[type=submit]");
};
step("wrong setup code is refused, nothing created"); await p.goto(`${base}/en/welcome`);
await fill("not-the-code"); await p.waitForSelector(".form-msg.error");
assert.match(await p.textContent(".form-msg.error"), /not correct/);
step("right code creates the system and sends the invitation"); await fill("test-setup-token-0123456789abcdef");
await p.waitForSelector(".form-msg.ok", { timeout: 60000 });
assert.match(await p.textContent(".form-msg.ok"), /owner@evercrestco\.com/);
const state = await (await fetch(`${mock}/__state`)).json();
assert.equal(state.buckets[0].public, false, "documents bucket is private");
assert.equal(state.invites[0].email, "owner@evercrestco.com");
assert.match(state.invites[0].redirectTo, /\/api\/auth\/confirm\?next=\/ckb\/set-password$/);
step("the setup page is gone afterwards"); const r = await p.goto(`${base}/en/welcome`); assert.equal(r.status(), 404);
console.log("first-run setup: OK");
await b.close();
