#!/usr/bin/env python3
"""Builds the shareable guide page (docs/guide/site/index.html) from the guide's Markdown.

The Markdown in docs/guide is the source; this turns it into one page with a table of contents,
the ERP's Sandstone colours and fonts, and pictures that open larger on click.
Usage: python3 scripts/build-guide.py
"""
import html
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "docs" / "guide"
OUT = ROOT / "site" / "index.html"
CHAPTERS = ["01-trips-and-claims.md", "glossary.md"]


def inline(t: str) -> str:
    t = html.escape(t, quote=False)
    t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"(?<![*\w])\*([^*]+)\*(?!\w)", r"<em>\1</em>", t)
    t = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", lambda m: f'<a href="{m.group(2) if m.group(2).startswith("http") else "#" + slug(m.group(1))}">{m.group(1)}</a>', t)
    return t


def slug(s: str) -> str:
    s = re.sub(r"<[^>]+>", "", s).lower()
    s = re.sub(r"[^a-z0-9؀-ۿ]+", "-", s).strip("-")
    return s or "section"


def convert(md: str, toc: list) -> str:
    lines = md.split("\n")
    out = []
    i = 0
    para = []

    def flush():
        if para:
            out.append(f"<p>{inline(' '.join(para))}</p>")
            para.clear()

    while i < len(lines):
        line = lines[i]
        s = line.strip()
        if not s:
            flush(); i += 1; continue
        if s == "---":
            flush(); i += 1; continue
        m = re.match(r"^(#{1,4}) (.*)$", s)
        if m:
            flush()
            level = len(m.group(1))
            text = m.group(2)
            sid = slug(text)
            if level <= 2:
                toc.append((level, sid, re.sub(r"^\d+\.\s*", "", text) if level == 2 else text))
            out.append(f'<h{level} id="{sid}">{inline(text)}</h{level}>')
            i += 1; continue
        m = re.match(r"^!\[([^\]]*)\]\(([^)]+)\)$", s)
        if m:
            flush()
            alt, src = m.group(1), m.group(2)
            out.append(f'<figure><button class="shot" type="button" data-src="{src}" aria-label="Enlarge: {html.escape(alt)}"><img src="{src}" alt="{html.escape(alt)}" loading="lazy"></button><figcaption>{html.escape(alt)}</figcaption></figure>')
            i += 1; continue
        if s.startswith("|"):
            flush()
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            head, body = rows[0], [r for r in rows[1:] if not all(re.match(r"^:?-+:?$", c) for c in r)]
            t = ['<div class="table"><table><thead><tr>' + "".join(f"<th>{inline(c)}</th>" for c in head) + "</tr></thead><tbody>"]
            for r in body:
                t.append("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>")
            t.append("</tbody></table></div>")
            out.append("".join(t))
            continue
        if re.match(r"^(\d+)\. ", s) or s.startswith("- "):
            flush()
            ordered = bool(re.match(r"^\d+\. ", s))
            tag = "ol" if ordered else "ul"
            items = []
            while i < len(lines) and (re.match(r"^\d+\. ", lines[i].strip()) if ordered else lines[i].strip().startswith("- ")):
                items.append(re.sub(r"^(\d+\.|-) ", "", lines[i].strip()))
                i += 1
            out.append(f"<{tag}>" + "".join(f"<li>{inline(x)}</li>" for x in items) + f"</{tag}>")
            continue
        para.append(s)
        i += 1
    flush()
    return "\n".join(out)


def main():
    toc: list = []
    sections = []
    for name in CHAPTERS:
        md = (ROOT / name).read_text(encoding="utf-8")
        md = md.replace("](img/", "](img/")
        sections.append(f'<section class="chapter">{convert(md, toc)}</section>')
    nav = []
    for level, sid, text in toc:
        cls = "top" if level == 1 else ""
        nav.append(f'<li class="{cls}"><a href="#{sid}">{html.escape(re.sub(r"<[^>]+>", "", text))}</a></li>')
    page = TEMPLATE.replace("{{NAV}}", "\n".join(nav)).replace("{{BODY}}", "\n".join(sections))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(page, encoding="utf-8")
    print(f"wrote {OUT} ({len(page)//1024} KB, {len(toc)} headings)")


TEMPLATE = """<title>Evercrest Owner's Guide</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Vazirmatn:wght@400;600;700&display=swap">
<style>
/* Layout: the ERP's Sandstone palette; a quiet contents rail beside one readable column of steps and pictures. */
:root {
  --bg: #f6f2ec; --panel: #fffdfa; --ink: #26231f; --muted: #776e62; --line: #e3dbcf;
  --accent: #1f5e5b; --accent-ink: #133f3d; --accent-soft: #e6efed; --note: #fbf2e2; --note-line: #eed7ae;
  --display: "Manrope", "Vazirmatn", ui-sans-serif, system-ui, sans-serif;
  --body: "Manrope", "Vazirmatn", ui-sans-serif, system-ui, sans-serif;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #1c1a17; --panel: #24211d; --ink: #f1ece4; --muted: #b3a998; --line: #3a352e;
  --accent: #7cc4bc; --accent-ink: #a9ddd6; --accent-soft: #233532; --note: #2e2719; --note-line: #5a4a2c; color-scheme: dark } }
:root[data-theme="dark"] {
  --bg: #1c1a17; --panel: #24211d; --ink: #f1ece4; --muted: #b3a998; --line: #3a352e;
  --accent: #7cc4bc; --accent-ink: #a9ddd6; --accent-soft: #233532; --note: #2e2719; --note-line: #5a4a2c; color-scheme: dark }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: 16px; }
body { background: var(--bg); color: var(--ink); font: 400 16px/1.65 var(--body); }
.wrap { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 40px; max-width: 1180px; margin: 0 auto;
  padding-block: 32px 80px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
nav.toc { position: sticky; top: env(safe-area-inset-top, 0px); align-self: start; max-height: 100vh; overflow: auto; padding-top: 8px; }
nav.toc .brand { font: 800 15px/1.2 var(--display); color: var(--accent-ink); letter-spacing: .01em; margin-bottom: 4px; }
nav.toc .sub { font-size: 13px; color: var(--muted); margin-bottom: 18px; }
nav.toc ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
nav.toc li a { display: block; padding: 5px 10px; border-radius: 8px; color: var(--ink); text-decoration: none; font-size: 13.5px; }
nav.toc li.top a { font-weight: 800; color: var(--accent-ink); margin-top: 10px; }
nav.toc li a:hover, nav.toc li a.on { background: var(--accent-soft); color: var(--accent-ink); }
main { min-width: 0; max-width: 780px; }
.chapter + .chapter { margin-top: 72px; padding-top: 32px; border-top: 1px solid var(--line); }
h1 { font: 800 clamp(28px, 4vw, 40px)/1.15 var(--display); letter-spacing: -.01em; margin: 0 0 12px; text-wrap: balance; }
h2 { font: 800 24px/1.25 var(--display); margin: 56px 0 12px; text-wrap: balance; }
h3 { font: 700 18px/1.3 var(--display); margin: 32px 0 8px; color: var(--accent-ink); }
p, li { max-width: 68ch; }
p { margin: 0 0 14px; }
ul, ol { margin: 0 0 16px; padding-inline-start: 22px; display: grid; gap: 6px; }
strong { font-weight: 700; }
a { color: var(--accent); text-underline-offset: 3px; }
code { font-size: .9em; background: var(--accent-soft); padding: 1px 6px; border-radius: 6px; }
.table { overflow-x: auto; margin: 8px 0 22px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); }
table { border-collapse: collapse; width: 100%; font-size: 14.5px; font-variant-numeric: tabular-nums; }
th, td { text-align: start; vertical-align: top; padding: 9px 12px; border-bottom: 1px solid var(--line); }
th { font-size: 12.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); background: color-mix(in oklab, var(--panel) 85%, var(--line)); }
tr:last-child td { border-bottom: 0; }
td { unicode-bidi: plaintext; }
figure { margin: 14px 0 26px; }
.shot { display: block; width: 100%; padding: 0; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: var(--panel); cursor: zoom-in; }
.shot img { display: block; width: 100%; height: auto; }
.shot:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
figcaption { font-size: 13px; color: var(--muted); margin-top: 6px; }
.intro { background: var(--note); border: 1px solid var(--note-line); border-radius: 14px; padding: 14px 18px; margin: 0 0 28px; font-size: 15px; }
dialog.zoom { border: 0; padding: 0; background: transparent; max-width: 96vw; max-height: 96vh; }
dialog.zoom::backdrop { background: rgb(20 18 15 / .78); }
dialog.zoom img { display: block; max-width: 96vw; max-height: 92vh; border-radius: 10px; cursor: zoom-out; }
@media (max-width: 960px) {
  .wrap { grid-template-columns: minmax(0, 1fr); gap: 16px; }
  nav.toc { position: static; max-height: none; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); padding: 12px; }
  nav.toc ol { max-height: 260px; overflow: auto; }
}
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
</style>
<div class="wrap">
  <nav class="toc" aria-label="Contents">
    <div class="brand">Evercrest Operations ERP</div>
    <div class="sub">Owner's guide · Chapter 1: trips and claims</div>
    <ol>
{{NAV}}
    </ol>
  </nav>
  <main>
    <div class="intro">Read a section, try it on the live system at <a href="https://evercrest-erp.vercel.app">evercrest-erp.vercel.app</a>, then decide whether the next step starts. Click any picture to see it larger.</div>
{{BODY}}
  </main>
</div>
<dialog class="zoom" id="zoom" aria-label="Picture"><img id="zoom-img" alt=""></dialog>
<script>
(() => {
  const dlg = document.getElementById("zoom"), img = document.getElementById("zoom-img");
  document.querySelectorAll(".shot").forEach((b) => b.addEventListener("click", () => { img.src = b.dataset.src; img.alt = b.querySelector("img").alt; dlg.showModal(); }));
  dlg.addEventListener("click", () => dlg.close());
  // Highlight the section being read in the contents.
  const links = [...document.querySelectorAll("nav.toc a")];
  const byId = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
  const obs = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { links.forEach((a) => a.classList.remove("on")); byId.get(e.target.id)?.classList.add("on"); } }), { rootMargin: "0px 0px -70% 0px" });
  document.querySelectorAll("main h1[id], main h2[id]").forEach((h) => obs.observe(h));
})();
</script>
"""

if __name__ == "__main__":
    main()
