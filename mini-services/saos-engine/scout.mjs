// scout.mjs — SOVEREIGN DISCOVERY + SAFETY SCREEN (T-525).
// The wandering-sovereignty way to learn from the world without swallowing
// poison: multiple discovery sources → per-repo GitHub truth → malware
// heuristic screen → honest verdicts. NOTHING is auto-installed: output is
// a verdict list for the architecture to STUDY (patterns become our own —
// the Bytebase lesson), integration is always a separate human-approved step.
//
// HONEST LIMITS (stated, never hidden): this is a SCREEN, not a sandbox —
// heuristics catch the common traps (install-script hooks, typosquats,
// red-flag payloads, dead/unlicensed repos); they cannot prove absence of
// malware. Deep audit before running anything stays mandatory.
//
// Sources: GitHub Search API (public) · github.com/trending (HTML) ·
//          pinoyfreecoder github-finds (attempted; Cloudflare-gated → honest skip)
// Usage:   bun scout.mjs "search query" [--limit 12]
import * as fs from "node:fs";
import * as crypto from "node:crypto";

const UA = "saos-scout/1 (roshpinacare-sys sovereign research; contact: repo issues)";
const FAMOUS = ["react", "express", "next", "lodash", "axios", "ethers", "web3", "viem", "prisma", "chalk", "debug", "request", "socket", "redis", "mongoose", "fastify", "vite", "eslint", "typescript", "jest"];
const RED_FLAGS = ["crypto miner", "xmrig", "free nitro", "discord webhook", "eval(atob", "eval(Buffer.from", "child_process.*curl", "curl.*\\|.*sh", "wallet.dat", "seed phrase", "private key stealer", "rattox", "paste.ee", "ngrok tunnel"];
const INSTALL_HOOKS = ["preinstall", "install", "postinstall", "prepare"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KEY_FILES = ["./.env", "/tmp/.env.local", "./keys.env", "../../.env.local"];
function vaultSlot(name) {
  if (process.env[name]) return process.env[name].trim();
  for (const f of KEY_FILES) {
    try {
      const m = fs.readFileSync(f, "utf8").match(new RegExp(`^${name}=(.+)$`, "m"));
      if (m?.[1]) return m[1].trim();
    } catch { /* absent */ }
  }
  return "";
}
function ghHeaders() {
  const h = { "User-Agent": UA, Accept: "application/vnd.github+json" };
  const tok = vaultSlot("GITHUB_PAT");
  if (tok) h.Authorization = `Bearer ${tok}`;
  return h;
}
async function gh(path) {
  const r = await fetch(`https://api.github.com${path}`, { headers: ghHeaders(), signal: AbortSignal.timeout(15000) });
  if (r.status === 403 && r.headers.get("x-ratelimit-remaining") === "0") throw new Error("github-api-rate-limited (public quota — retry later or with token)");
  if (!r.ok) throw new Error(`gh ${r.status} ${path}`);
  return r.json();
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[m][n];
}

const days = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

async function screenRepo(fullName) {
  const meta = await gh(`/repos/${fullName}`);
  const reasons = [];
  let verdict = "PASS";
  let contribs = null;
  const ageD = days(meta.created_at), pushD = days(meta.pushed_at);
  const license = meta.license?.spdx_id ?? null;
  if (!license || license === "NOASSERTION") { reasons.push("no-identified-license"); verdict = "FLAG"; }
  if (meta.archived) reasons.push("archived");
  if (ageD < 90) { reasons.push(`young:${ageD}d`); if (verdict === "PASS") verdict = "FLAG"; }
  if (pushD > 365) { reasons.push(`stale:${pushD}d-since-push`); if (verdict === "PASS") verdict = "FLAG"; }
  if (meta.fork) { reasons.push("fork:not-original-source"); if (verdict === "PASS") verdict = "FLAG"; } // T-526: forks hide the true origin — study the parent instead

  // T-526 contributor-concentration anomaly: hype pattern = many stars but a
  // single contributor on a young repo (common in fake-project / dropper repos).
  try {
    const c = await gh(`/repos/${fullName}/contributors?per_page=100&anon=1`);
    contribs = Array.isArray(c) ? c.length : 0;
    if (contribs <= 1 && ageD < 180 && (meta.stargazers_count ?? 0) >= 50) { reasons.push(`single-contributor-hype:${contribs}c/${meta.stargazers_count}stars`); if (verdict === "PASS") verdict = "FLAG"; }
  } catch { /* contributors endpoint optional */ }

  // install-hook + payload screen on the root package.json (JS ecosystems)
  let hooks = [];
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${fullName}/${meta.default_branch}/package.json`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
    if (r.ok) {
      const pkg = await r.json();
      hooks = INSTALL_HOOKS.filter((h) => pkg.scripts?.[h]);
      if (hooks.length) { reasons.push(`install-hooks:${hooks.join(",")}`); if (verdict === "PASS") verdict = "FLAG"; }
      const name = String(pkg.name ?? "").split("/").pop();
      if (name) {
        const near = FAMOUS.map((f) => [f, levenshtein(name.toLowerCase(), f)]).sort((a, b) => a[1] - b[1])[0];
        if (near[1] > 0 && near[1] <= 2 && ageD < 365) { reasons.push(`typosquat-risk:${name}~${near[0]}(d=${near[1]})`); verdict = "REJECT"; }
      }
    } else reasons.push("no-root-package.json");
  } catch { reasons.push("package.json-unreadable"); }

  // README payload red flags (first 8KB)
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${fullName}/${meta.default_branch}/README.md`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
    if (r.ok) {
      const txt = (await r.text()).slice(0, 8192).toLowerCase();
      const hits = RED_FLAGS.filter((f) => new RegExp(f.replace(/\*/g, ".*")).test(txt));
      if (hits.length) { reasons.push(`readme-redflags:${hits.join("|")}`); verdict = "REJECT"; }
    }
  } catch { /* readme optional */ }

  return {
    repo: fullName, url: meta.html_url, stars: meta.stargazers_count, forks: meta.forks_count,
    ageDays: ageD, daysSincePush: pushD, license, archived: !!meta.archived,
    fork: !!meta.fork, ownerType: meta.owner?.type ?? null, contributors: contribs,
    language: meta.language, description: (meta.description ?? "").slice(0, 160),
    installHooks: hooks, verdict, reasons, screenedAt: new Date().toISOString(),
  };
}

async function discover(query, limit) {
  const out = [];
  // 1) GitHub search (public API)
  try {
    const s = await gh(`/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${limit}`);
    out.push(...(s.items ?? []).map((i) => i.full_name));
  } catch (e) { console.error(JSON.stringify({ source: "github-search", ok: false, error: String(e).slice(0, 140) })); }
  // 2) github.com/trending (HTML, no API quota)
  try {
    const r = await fetch("https://github.com/trending?since=weekly", { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
    if (r.ok) {
      const html = await r.text();
      const t = [...html.matchAll(/href="\/([\w.-]+\/[\w.-]+)\/stargazers"/g)].map((m) => m[1]);
      out.push(...[...new Set(t)].slice(0, Math.ceil(limit / 2)));
    }
  } catch (e) { console.error(JSON.stringify({ source: "github-trending", ok: false, error: String(e).slice(0, 140) })); }
  // 3) owner-curated site — attempted honestly, Cloudflare-gated from this env
  try {
    const r = await fetch("https://pinoyfreecoder.com/github-finds", { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12000) });
    if (r.status === 403) console.error(JSON.stringify({ source: "pinoyfreecoder-github-finds", ok: false, error: "cloudflare-gated-from-this-environment (retry later / paste links manually)" }));
    else {
      const html = await r.text();
      out.push(...[...new Set([...html.matchAll(/https:\/\/github\.com\/([\w.-]+\/[\w.-]+)/g)].map((m) => m[1]))].slice(0, limit));
    }
  } catch (e) { console.error(JSON.stringify({ source: "pinoyfreecoder-github-finds", ok: false, error: String(e).slice(0, 140) })); }
  return [...new Set(out)].slice(0, limit);
}

const query = process.argv[2] ?? "autonomous ai agent framework";
const limit = Number(process.argv[4] ?? process.argv[3] ?? 12) || 12;
const candidates = await discover(query, limit);
const screened = [];
for (const c of candidates) {
  try { screened.push(await screenRepo(c)); } catch (e) { screened.push({ repo: c, verdict: "UNSCREENED", error: String(e).slice(0, 140) }); }
  await sleep(400); // public-quota courtesy
}
const report = {
  protocol: "saos.scout.v1", query, candidates: screened.length,
  verdicts: screened.reduce((a, s) => { a[s.verdict] = (a[s.verdict] ?? 0) + 1; return a; }, {}),
  screened, note: "screen-not-sandbox — deep audit before running anything stays mandatory",
  at: new Date().toISOString(),
};
fs.mkdirSync("./scout-state", { recursive: true });
fs.writeFileSync(`./scout-state/${crypto.createHash("sha1").update(query + report.at).digest("hex").slice(0, 10)}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: true, query, candidates: report.candidates, verdicts: report.verdicts, top: screened.filter((s) => s.verdict === "PASS").slice(0, 5).map((s) => ({ repo: s.repo, stars: s.stars, license: s.license, ageDays: s.ageDays })) }));
