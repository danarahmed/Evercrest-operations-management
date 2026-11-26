// Layout check: every main screen, in English and Arabic, at a 1366 px laptop width.
// Fails when the page scrolls sideways, a table is wider than its box, or anything inside a
// dialog does not fit: content wider than the dialog, a field or label cut off, a sideways scrollbar.
// Every dialog on each page is opened, checked and closed.
// Usage: BASE_URL=http://localhost:3100 node e2e/layout-flow.mjs   (needs AUTH_MODE=dev + seeded dev data; run after the other flows)
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://localhost:3100";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1366, height: 820 } });
const problems = [];

await page.goto(`${base}/en/login`);
await page.click("button:has-text('Admin')");
await page.waitForURL(`${base}/en`);

// Pages to check: fixed ones, plus the first job, claim, statement and import found in the data.
await page.goto(`${base}/en/jobs`);
const jobHref = await page.locator("a:has-text('Diesel to Field X')").first().getAttribute("href");
await page.goto(`${base}/en/claims`);
const claimHref = await page.locator("table a.cell-title").first().getAttribute("href").catch(() => null);
await page.goto(`${base}/en/statements?tab=list`);
const statementHref = await page.locator("a[href*='/statements/']").first().getAttribute("href").catch(() => null);
await page.goto(`${base}/en/finance/partners`);
const partnerHref = await page.locator("a[href*='/finance/partners/']").first().getAttribute("href").catch(() => null);

const paths = [
  "", "/jobs", "/jobs/new", "/trips", "/claims", "/claims/held", "/claims/held?do=give", "/claims/held?do=close&old=1", "/statements", "/documents", "/approvals", "/reports",
  "/finance", "/finance/accounts", "/finance/journal", "/finance/partners", "/finance/exchange",
  "/setup", "/setup?tab=catalog", "/setup?tab=operations", "/setup?tab=accounting", "/setup?tab=settings", "/admin",
  ...["", "?tab=trips", "?tab=rules", "?tab=claims", "?tab=documents", "?tab=money", "?tab=steps", "?tab=history", "?tab=customs"].map((t) => `${jobHref.replace(/^\/en/, "")}${t}`),
  ...[claimHref, statementHref, partnerHref].filter(Boolean).map((h) => h.replace(/^\/en/, "")),
];

const measure = () => {
  const out = [];
  const label = (el) => (el.getAttribute("aria-label") || el.textContent || el.tagName).replace(/\s+/g, " ").trim().slice(0, 50);
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`page scrolls sideways by ${document.documentElement.scrollWidth - innerWidth}px`);
  document.querySelectorAll(".table-wrap").forEach((w) => {
    if (w.closest("dialog")) return;
    const extra = w.scrollWidth - w.clientWidth;
    if (extra > 1) out.push(`table wider than its box by ${extra}px: "${label(w.querySelector("th") || w)}"`);
  });
  return out;
};

const measureDialog = () => {
  const d = document.querySelector("dialog[open]");
  if (!d) return ["dialog did not open"];
  const out = [];
  const box = d.getBoundingClientRect();
  const name = (d.querySelector(".modal-title")?.textContent || "dialog").trim().slice(0, 40);
  if (d.scrollWidth > d.clientWidth + 1) out.push(`dialog "${name}" scrolls sideways by ${d.scrollWidth - d.clientWidth}px`);
  const body = d.querySelector(".modal-body") || d;
  if (body.scrollWidth > body.clientWidth + 1) out.push(`dialog "${name}" content wider than the dialog by ${body.scrollWidth - body.clientWidth}px`);
  d.querySelectorAll("input:not([type=hidden]), select, textarea, button, label").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    if (r.right > box.right + 1 || r.left < box.left - 1) out.push(`dialog "${name}": ${el.tagName.toLowerCase()} "${(el.getAttribute("name") || el.textContent || "").trim().slice(0, 30)}" sticks out of the dialog`);
  });
  d.querySelectorAll("label").forEach((l) => {
    const text = [...l.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join("");
    if (!text) return;
    const range = document.createRange();
    const node = [...l.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if (r.width === 0 || r.right > box.right + 1 || r.left < box.left - 1) out.push(`dialog "${name}": label "${text.slice(0, 30)}" is hidden or cut off`);
  });
  return [...new Set(out)];
};

for (const loc of ["en", "ar"]) {
  for (const path of paths) {
    const url = `${base}/${loc}${path}`;
    await page.goto(url);
    await page.waitForTimeout(400);
    for (const p of await page.evaluate(measure)) problems.push(`${loc}${path}: ${p}`);
    // Open every dialog on the page, one at a time.
    const count = await page.locator("dialog.modal").count();
    for (let i = 0; i < count; i++) {
      const opened = await page.evaluate((idx) => {
        const d = document.querySelectorAll("dialog.modal")[idx];
        if (!d || d.open) return false;
        d.showModal();
        return true;
      }, i);
      if (!opened) continue;
      await page.waitForTimeout(220);
      for (const p of await page.evaluate(measureDialog)) problems.push(`${loc}${path}: ${p}`);
      await page.evaluate((idx) => document.querySelectorAll("dialog.modal")[idx]?.close(), i);
    }
  }
}

await browser.close();
if (problems.length) {
  console.log(`layout problems (${problems.length}):\n- ${[...new Set(problems)].join("\n- ")}`);
  process.exit(1);
}
console.log(`e2e layout check: OK (${paths.length * 2} screens, every dialog opened)`);
