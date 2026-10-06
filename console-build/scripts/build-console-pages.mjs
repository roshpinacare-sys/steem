#!/usr/bin/env node
// build-console-pages.mjs - installs the Adsmarket assets into the public Console
// (Task 34: engineer + edit + publish the existing folders, at the most professional level)
//
//   about/     <- index-en.html      (marketing landing)
//   onepager/  <- onepager-en.html
//   deck/      <- deck/index.html    (partners & investors deck)
//   receipts/  <- receipts.html      (on-chain receipts)
//   hub/       <- content/hub.html + every linked .md rendered as styled HTML
//
// Zero deps. Deterministic. Every .md link is rewritten to its rendered .html twin;
// dangling sources redirect to the hub home instead of 404.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, cpSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";

const SRC = "/tmp/research/Adsmarket";
const OUT = "/home/z/my-project/console-live";
const SITE = "https://roshpinacare-sys.github.io/Console";

const report = { pages: [], md: [], dangling: [], rewritten: 0 };

/* ─────────── markdown -> HTML (escape-first, then format) ─────────── */
const escH = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(s) {
  return s
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" loading="lazy">')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>");
}

function mdTable(lines) {
  const rows = lines.map((l) => l.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim()));
  const head = rows[0], body = rows.slice(2);
  return `<div class="tbl"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body
    .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;
}

function markdown(md) {
  md = md.replace(/\r\n/g, "\n").replace(/<!--.*?-->/gs, "");
  const lines = md.split("\n");
  let html = "", i = 0, list = null, para = [];
  const flushP = () => { if (para.length) { html += `<p>${inline(para.join(" "))}</p>`; para = []; } };
  const flushL = () => { if (list) { html += list === "ul" ? "</ul>" : "</ol>"; list = null; } };
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) {
      flushP(); flushL();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      html += `<pre><code>${escH(buf.join("\n"))}</code></pre>`;
      continue;
    }
    if (/^\s*\|.*\|/.test(l) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|/.test(lines[i + 1])) {
      flushP(); flushL();
      const buf = [];
      while (i < lines.length && /\|/.test(lines[i])) buf.push(lines[i++]);
      html += mdTable(buf);
      continue;
    }
    let m;
    if ((m = l.match(/^(#{1,6})\s+(.*)$/))) {
      flushP(); flushL();
      const lvl = m[1].length;
      html += `<h${lvl}>${inline(m[2])}</h${lvl}>`;
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) {
      flushP(); flushL(); html += "<hr>";
    } else if ((m = l.match(/^\s*[-*+]\s+(.*)$/))) {
      flushP();
      if (list !== "ul") { flushL(); html += "<ul>"; list = "ul"; }
      html += `<li>${inline(m[1])}</li>`;
    } else if ((m = l.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushP();
      if (list !== "ol") { flushL(); html += "<ol>"; list = "ol"; }
      html += `<li>${inline(m[1])}</li>`;
    } else if ((m = l.match(/^\s*>\s?(.*)$/))) {
      flushP(); flushL();
      const buf = [m[1]];
      while (i + 1 < lines.length && /^\s*>\s?/.test(lines[i + 1])) buf.push(lines[++i].replace(/^\s*>\s?/, ""));
      html += `<blockquote>${inline(buf.join(" "))}</blockquote>`;
    } else if (/^\s*$/.test(l)) {
      flushP(); flushL();
    } else {
      flushL(); para.push(l.trim());
    }
    i++;
  }
  flushP(); flushL();
  return html;
}

/* ─────────── page shell (site design language) ─────────── */
function isHe(s) {
  const h = (s.match(/[\u0590-\u05FF]/g) || []).length;
  return h / Math.max(1, s.replace(/\s/g, "").length) > 0.06;
}

function shell(title, bodyHtml, he, nav) {
  const dir = he ? "rtl" : "ltr";
  const back = nav.backLabel || (he ? "חזרה לקונסולה" : "Back to the console");
  const hub = he ? "מרכז התוכן" : "Content hub";
  const rootHref = nav.rootHref, hubHref = nav.hubHref;
  return `<!DOCTYPE html>
<html lang="${he ? "he" : "en"}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escH(title)} · SAOS</title>
<meta name="description" content="${escH(title)} - SAOS Network">
<meta name="theme-color" content="#050507">
<link rel="canonical" href="${SITE}/hub/">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 2.5 20.5 7v10L12 21.5 3.5 17V7z' fill='none' stroke='%23d4af37' stroke-width='1.6'/%3E%3Ccircle cx='12' cy='12' r='3' fill='%23d4af37'/%3E%3C/svg%3E">
<style>
:root{--bg:#050507;--bg2:#0a0a10;--panel:rgba(255,255,255,.028);--line:rgba(212,175,55,.16);--line2:rgba(212,175,55,.32);
--gold:#d4af37;--gold-bright:#f0d060;--violet:#a78bfa;--green:#22c55e;--red:#ef4444;--text:#f4f4f5;--dim:#a1a1aa;--faint:#71717a;
--mono:ui-monospace,'SF Mono','Cascadia Code',Menlo,Consolas,monospace;
--sans:-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans Hebrew',sans-serif}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:var(--sans);line-height:1.75;min-height:100vh;display:flex;flex-direction:column;-webkit-font-smoothing:antialiased}
header.top{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:16px;padding:12px 22px;background:rgba(5,5,7,.88);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
header.top .logo{font-family:var(--mono);font-weight:800;letter-spacing:.12em;font-size:17px;color:var(--gold);text-decoration:none;display:flex;align-items:center;gap:9px}
header.top .sp{flex:1}
header.top a.lnk{color:var(--dim);font-size:13px;text-decoration:none;border:1px solid var(--line);border-radius:9px;padding:6px 13px}
header.top a.lnk:hover{color:var(--gold-bright);border-color:var(--line2)}
main{flex:1;width:100%;max-width:880px;margin:0 auto;padding:36px 22px 64px}
h1{font-size:clamp(25px,4.5vw,36px);line-height:1.25;margin-bottom:10px;color:var(--text)}
h1 em,h1 .gold{color:var(--gold);font-style:normal}
h2{font-size:21px;margin:30px 0 10px;color:var(--gold-bright)}
h3{font-size:17px;margin:22px 0 8px}
p{margin:10px 0;color:#d4d4d8}
a{color:var(--gold)}
ul,ol{margin:10px 0 10px 24px;color:#d4d4d8}
li{margin:5px 0}
code{font-family:var(--mono);background:rgba(212,175,55,.09);border:1px solid var(--line);border-radius:5px;padding:1px 6px;font-size:.88em;direction:ltr;unicode-bidi:embed}
pre{background:var(--bg2);border:1px solid var(--line);border-radius:12px;padding:16px;overflow-x:auto;margin:14px 0}
pre code{background:none;border:none;padding:0;font-size:12.5px;line-height:1.6}
blockquote{border-inline-start:3px solid var(--gold);padding:8px 16px;margin:14px 0;background:var(--panel);border-radius:0 10px 10px 0;color:var(--dim)}
hr{border:none;border-top:1px dashed var(--line2);margin:26px 0}
.tbl{overflow-x:auto;margin:14px 0}
table{border-collapse:collapse;width:100%;font-size:13.5px}
th{color:var(--gold-bright);text-align:start;border-bottom:1px solid var(--line2);padding:8px 10px}
td{border-bottom:1px solid rgba(255,255,255,.06);padding:8px 10px;color:#d4d4d8}
img{max-width:100%;border-radius:12px}
footer.site{border-top:1px solid var(--line);padding:16px 22px;text-align:center;color:var(--faint);font-size:12.5px}
footer.site a{color:var(--dim)}
.mono{font-family:var(--mono)}
@media print{body{background:#fff;color:#111}header.top{position:static}}
</style>
</head>
<body>
<header class="top">
  <a class="logo" href="${rootHref}">
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7z" fill="none" stroke="#d4af37" stroke-width="1.6"/><circle cx="12" cy="12" r="3" fill="#d4af37"/></svg>
    SAOS
  </a>
  <span class="sp"></span>
  <a class="lnk" href="${hubHref}">${hub}</a>
  <a class="lnk" href="${rootHref}">${back}</a>
</header>
<main>
${bodyHtml}
</main>
<footer class="site">SAOS Network · <a href="${SITE}/">Console</a> · <a href="${SITE}/#network">Verify independently</a></footer>
</body>
</html>`;
}

/* ─────────── collect the md sources to render ─────────── */
const MD_FILES = [];
function collect(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === ".git" || name === "assets") continue;
      collect(p);
    } else if (name.endsWith(".md")) {
      MD_FILES.push({ abs: p, rel: relative(SRC, p) });
    }
  }
}
collect(join(SRC, "content"));
collect(join(SRC, "press"));
collect(join(SRC, "developers"));
collect(join(SRC, "docs"));
for (const f of ["brand.md", "compare.md", "faq.md", "glossary.md", "fact-sheet.md", "pitch.md", "social.md", "ecosystem.md", "disclosure-policy.md", "crisis-playbook.md"]) {
  if (existsSync(join(SRC, f))) MD_FILES.push({ abs: join(SRC, f), rel: f });
}

/* map an Adsmarket-relative path -> output html path under hub/ */
function mdToHtml(rel) {
  if (rel.startsWith("content/")) rel = rel.slice("content/".length);
  return "hub/" + rel.replace(/\.md$/i, "") + ".html";
}

/* depth-aware nav for an output file path like hub/articles/en/x.html */
function navFor(outRelFile) {
  const d = outRelFile.split("/").length - 1;
  return {
    rootHref: d === 0 ? "./" : "../".repeat(d),
    hubHref: d <= 1 ? "index.html" : "../".repeat(d - 1),
  };
}

/* ─────────── render every md ─────────── */
for (const f of MD_FILES) {
  const raw = readFileSync(f.abs, "utf8");
  const title = (raw.match(/^#\s+(.+)$/m) || [, f.rel])[1].trim();
  let body = markdown(raw);
  /* rewrite relative md links inside the rendered body */
  body = body.replace(/\[([^\]]*)\]\(([^)#\s]+\.md)(#[^)\s]*)?\)/g, (all, txt, href, hash) => {
    const absTo = resolve(dirname(f.abs), href);
    const relTo = relative(SRC, absTo);
    const target = mdToHtml(relTo);
    if (MD_FILES.some((x) => x.rel === relTo)) {
      report.rewritten++;
      return `<a href="${SITE}/${target}">${txt}</a>`;
    }
    report.dangling.push(`${f.rel} -> ${href}`);
    return `<a href="${SITE}/hub/" title="not yet published">${txt}</a>`;
  });
  const he = isHe(raw);
  const outRel = mdToHtml(f.rel);
  const outDir = join(OUT, dirname(outRel));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(OUT, outRel), shell(title, body, he, navFor(outRel)));
  report.md.push(outRel);
}

/* ─────────── install the designed HTML pages, rewriting their links ─────────── */
const PAGES = [
  { src: "index-en.html", out: "about/index.html" },
  { src: "onepager-en.html", out: "onepager/index.html" },
  { src: "deck/index.html", out: "deck/index.html" },
  { src: "receipts.html", out: "receipts/index.html" },
  { src: "content/hub.html", out: "hub/index.html" },
];

const REWRITES = [
  /* hub.html (source lives in content/, installed at hub/) */
  [/href="\.\.\/index\.html"/g, 'href="../"'],
  [/href="\.\.\/index-en\.html"/g, 'href="../about/"'],
  [/href="\.\.\/onepager\.html"/g, 'href="../onepager/"'],
  [/href="\.\.\/onepager-en\.html"/g, 'href="../onepager/"'],
  [/href="\.\.\/deck\/index\.html"/g, 'href="../deck/"'],
  [/href="\.\.\/broadcasts\/"/g, 'href="#" title="not yet published"'],
  [/href="\.\.\/strategy\/[^"]*"/g, 'href="#" title="not yet published"'],
  /* root md files, referenced from hub as ../X.md */
  [/href="\.\.\/brand\.md"/g, 'href="brand.html"'],
  [/href="\.\.\/compare\.md"/g, 'href="compare.html"'],
  [/href="\.\.\/fact-sheet\.md"/g, 'href="fact-sheet.html"'],
  [/href="\.\.\/faq\.md"/g, 'href="faq.html"'],
  [/href="\.\.\/glossary\.md"/g, 'href="glossary.html"'],
  [/href="\.\.\/pitch\.md"/g, 'href="pitch.html"'],
  [/href="\.\.\/social\.md"/g, 'href="social.html"'],
  [/href="\.\.\/press\/press-kit\.md"/g, 'href="press/press-kit.html"'],
  [/href="\.\.\/developers\/identity-api\.md"/g, 'href="developers/identity-api.html"'],
  [/href="\.\.\/guides\/([^"]+)\.md"/g, 'href="guides/$1.html"'],
  /* content-relative md links (hub.html sits at the same depth as content/) */
  [/href="articles\/en\/([^"]+)\.md"/g, 'href="articles/en/$1.html"'],
  [/href="(ads|email|fleet|guides|products|seo|video|api)\/([^"]+)\.md"/g, 'href="$1/$2.html"'],
  [/href="OPS-DOCTRINE\.md"/g, 'href="OPS-DOCTRINE.html"'],
  /* about + receipts (source lives at repo root) */
  [/href="fact-sheet\.md"/g, 'href="../hub/fact-sheet.html"'],
  [/href="press\/press-kit\.md"/g, 'href="../hub/press/press-kit.html"'],
  [/href="content\/guides\/([^"]+)\.md"/g, 'href="../hub/guides/$1.html"'],
  [/href="docs\/reports\/"/g, 'href="../hub/docs/reports/"'],
  [/href="index\.html"/g, 'href="../"'],
  [/href="deck\/index\.html"/g, 'href="../deck/"'],
];

for (const p of PAGES) {
  let html = readFileSync(join(SRC, p.src), "utf8");
  for (const [re, to] of REWRITES) html = html.replace(re, to);
  const outDir = join(OUT, dirname(p.out));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(OUT, p.out), html);
  report.pages.push(p.out);
}

/* ─────────── Hebrew article names -> their English twins (same NN prefix) ─────────── */
const EN_DIR = join(SRC, "content/articles/en");
const enFiles = existsSync(EN_DIR) ? readdirSync(EN_DIR).filter((f) => f.endsWith(".md")) : [];
const heMap = {};
for (const f of enFiles) {
  const nn = f.match(/^(\d+)/);
  if (nn) heMap[nn[1]] = f.replace(/\.md$/, "");
}
{
  const hubPath = join(OUT, "hub/index.html");
  let hub = readFileSync(hubPath, "utf8");
  hub = hub.replace(/href="articles\/([^"/]+)\.(?:md|html)"/g, (all, name) => {
    const nn = name.match(/^(\d+)/);
    if (heMap[nn?.[1] || ""]) return `href="articles/en/${heMap[nn[1]]}.html"`;
    report.dangling.push("hub articles/" + name);
    return 'href="#" title="not yet published"';
  });
  writeFileSync(hubPath, hub);
}

/* ─────────── copy designed html that already exists (explainer) ─────────── */
for (const dir of ["content/explainer"]) {
  const srcDir = join(SRC, dir);
  if (!existsSync(srcDir)) continue;
  const outDir = join(OUT, "hub/explainer");
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(srcDir)) {
    if (f.endsWith(".html")) { cpSync(join(srcDir, f), join(outDir, f)); report.pages.push("hub/explainer/" + f); }
  }
}

/* ─────────── directory indexes (e.g. docs/reports) ─────────── */
function walkHtml(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== ".git") out.push(...walkHtml(p)); }
    else if (name.endsWith(".html")) out.push(p);
  }
  return out;
}
function dirIndex(dir) {
  const rel = relative(OUT, dir);
  const d = rel.split("/").length; /* dir depth below root */
  const nav = { rootHref: "../".repeat(d), hubHref: "../".repeat(d - 1) };
  const children = readdirSync(dir).filter((f) => f.endsWith(".html") && f !== "index.html");
  const items = children.sort().map((f) => {
    const t = readFileSync(join(dir, f), "utf8").match(/<title>([^<]*)<\/title>/);
    return `<li style="margin:8px 0"><a class="mono" style="font-size:14px" href="${f}">${f.replace(/\.html$/, "")}</a><div style="color:var(--faint);font-size:12.5px">${t ? t[1] : ""}</div></li>`;
  }).join("");
  const title = rel.split("/").pop() + " - SAOS";
  writeFileSync(join(dir, "index.html"), shell(title, `<h1>${rel.split("/").pop()}</h1><ul style="list-style:none;padding:0">${items}</ul>`, true, nav));
  report.pages.push(rel + "/index.html");
}
for (const d of [join(OUT, "hub/docs/reports"), join(OUT, "hub/api")]) {
  if (existsSync(d) && !existsSync(join(d, "index.html"))) dirIndex(d);
}

/* ─────────── final link check: no local 404s anywhere ─────────── */
const allHtml = walkHtml(OUT).concat([join(OUT, "index.html")]);
let fixed = 0;
for (const page of allHtml) {
  let html = readFileSync(page, "utf8");
  const original = html;
  html = html.replace(/href="([^"#]*)"/g, (all, href) => {
    if (!href || /^(https?:|mailto:|data:|tel:)/.test(href)) return all;
    if (href.endsWith(".md")) {
      const target = resolve(dirname(page), href);
      if (!existsSync(target)) { fixed++; report.dangling.push(relative(OUT, page) + " -> " + href); return 'href="../hub/" title="source moved"'; }
      return all;
    }
    const target = resolve(dirname(page), href);
    if (!existsSync(target)) {
      fixed++;
      report.dangling.push(relative(OUT, page) + " -> " + href);
      const depth = relative(OUT, page).split("/").length - 1;
      return 'href="' + (depth === 0 ? "./" : "../".repeat(depth)) + 'hub/" title="not yet published"';
    }
    return all;
  });
  if (html !== original) writeFileSync(page, html);
}
report.linkFixed = fixed;

console.log("pages installed:", report.pages.length);
console.log("markdown rendered:", report.md.length);
console.log("md links rewritten:", report.rewritten);
console.log("dead links fixed:", report.linkFixed);
console.log("dangling sources:", [...new Set(report.dangling)].length);
for (const d of [...new Set(report.dangling)].slice(0, 20)) console.log("  ·", d);
