// Sign-in through Supabase Auth, end to end, without a live project.
// Start the stand-in auth service and the app in Supabase mode, e.g.:
//   node e2e/support/auth-mock.mjs &
//   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=x SUPABASE_SECRET_KEY=x \
//     SITE_URL=http://localhost:3200 DATABASE_URL=... npx next start -p 3200 &
//   BASE_URL=http://localhost:3200 node e2e/supabase-auth-flow.mjs
// Needs the dev seed (admin@evercrest.local) with no linked identity yet.
import { chromium } from "playwright";
import assert from "node:assert/strict";
const base = process.env.BASE_URL ?? "http://localhost:3200";
const step = (s) => console.log("step:", s);
const at = async (p, re) => { for (let i = 0; i < 60; i++) { if (re.test(p.url())) return; await p.waitForTimeout(250); } throw new Error(`still at ${p.url()}, wanted ${re}`); };
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
step("not signed in → sign-in page"); await p.goto(`${base}/en`); await at(p, /\/en\/login/);
await p.waitForSelector("input[name=email]");
step("wrong password → neutral message, e-mail kept"); await p.fill("input[name=email]", "admin@evercrest.local"); await p.fill("input[name=password]", "wrong-password");
await p.click("button[type=submit]"); await p.waitForSelector(".form-msg.error");
assert.match(await p.textContent(".form-msg.error"), /not correct/);
assert.equal(await p.inputValue("input[name=email]"), "admin@evercrest.local");
step("right password → home as the linked ERP user"); await p.fill("input[name=password]", "correct-horse-1"); await p.click("button[type=submit]");
await at(p, /\/en$/); await p.waitForSelector("main h1");
assert.match(await p.textContent("main h1"), /Admin/);
step("session carries to other pages"); await p.goto(`${base}/en/jobs`); assert.equal(new URL(p.url()).pathname, "/en/jobs");
step("sign out"); await p.hover("aside"); await p.click("button[aria-label='Sign out']"); await at(p, /\/en\/login/);
step("pages closed after sign-out"); await p.goto(`${base}/en/jobs`); await at(p, /\/en\/login/);
step("valid Supabase account never added in the ERP → no access"); await p.waitForSelector("input[name=email]"); await p.fill("input[name=email]", "stranger@gmail.com"); await p.fill("input[name=password]", "correct-horse-1"); await p.click("button[type=submit]");
await at(p, /error=no_access/); await p.waitForSelector(".form-msg.error");
step("link from a default e-mail template (session in the address fragment) → choose password");
const auth = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321";
const tok = await (await fetch(`${auth}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "admin@evercrest.local", password: "correct-horse-1" }) })).json();
await p.goto(`${base}/api/auth/confirm?next=/ar/set-password#access_token=${tok.access_token}&refresh_token=${tok.refresh_token}&type=invite`);
await at(p, /\/ar\/set-password/); await p.waitForSelector("input[name=confirm]");
step("fragment link without a session → expired-link message"); await p.context().clearCookies();
await p.goto(`${base}/api/auth/confirm?next=/en/set-password#error=access_denied`); await p.waitForSelector(".form-msg.error");
assert.match(await p.textContent(".form-msg.error"), /expired/);
step("forgot-password view (Kurdish)"); await p.goto(`${base}/ckb/login?view=forgot`);
console.log("supabase-mode sign-in flow: OK");
await b.close();
