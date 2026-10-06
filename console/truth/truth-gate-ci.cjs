#!/usr/bin/env node
/**
 * TRUTH-GATE (CI) - the machine that grades this public site, from Actions.
 *
 * Doctrine (BENCHMARK.md, stage 3): the system proves itself, without an
 * agent. This script runs on an hourly cadence inside the public Domain
 * repository (its own GITHUB_TOKEN, zero secrets) and measures the LIVE
 * deployed site - never the repo, never a local copy. Every verdict is
 * measured at run time; nothing here is written by hand.
 *
 * Output:
 *   truth/latest.json   - the full report of this run
 *   truth/history.json  - one line per run (capped, oldest pruned)
 *   truth/slo.json      - the SLO ledger (stage 4): targets, trailing
 *                         30-day window, error budgets, burn events
 * Exit code: 1 when any gate FAILs (the Actions run turns red in public).
 *
 * Gates measured from the public internet (CI-scope):
 *   G1 site-up · G2 zero-broken-links · G3 witness-freshness ·
 *   G5 live-format · G6 bridgehead-sane · G8 complete-map ·
 *   G9 slo-published · G10 moment-freshness · G11 mirror-freshness
 *   G12 weave-books-freshness
 * Sandbox-only gates (G4 local twins, G7 dev server) are recorded as SKIP
 * with an explicit reason - they belong to the sovereign machine
 * (scripts/benchmark-truth.cjs), not to this CI runner.
 *
 * SLO honesty rules (stage 4):
 *   1. A window that has not filled its 30 days shows WARMING - the verdict
 *      is provisional; a breached budget is breached even on day one.
 *   2. Runs recorded before this SLO engine was born (raw history only)
 *      are attributed to a gate ONLY when their verdict was ALL-GREEN
 *      (all gates passed, by definition). Pre-SLO red runs count toward
 *      totals and heartbeat, never toward a specific gate's SLI - no
 *      guessing which gate failed.
 *   3. Expected heartbeat runs are computed from the hourly cadence,
 *      bounded by the machine's birth on the first day and by "now" on
 *      the current day. Days with no runs at all still consume their
 *      expectation (a dead machine is visible in the SLI).
 */
"use strict";

const fs = require("fs");
const path = require("path");

const BASE = "https://roshpinacare-sys.github.io/Domain";
const HERE = __dirname;
const LATEST_PATH = path.join(HERE, "latest.json");
const HISTORY_PATH = path.join(HERE, "history.json");
const SLO_PATH = path.join(HERE, "slo.json");
const HISTORY_CAP = 200;

// The complete-map doctrine (R61): the nine system fronts are real pages
// again - restored, linked from the home map, present in the sitemap, and
// measured here (ok, >10KB, no stub marker). The single retired front
// (roast.html - a stale claims-audit snapshot superseded by the living
// truth gate) keeps its permanent redirect stub, and the internal session
// artifacts under hub/docs/reports/ must stay gone from the public site.
const SYSTEM_PAGES = [
  "net.html", "money.html", "deposits.html", "defi.html", "versus.html",
  "readiness.html", "sovereign.html", "acid.html", "gate.html",
];
const SYSTEM_MIN_BYTES = 10000;
const STUB_MAX_BYTES = 2500;
const STUB_REDIRECT_TO = "truth.html";

// The current-generation pages the link sweep walks (the console SPA, the
// wallet, the truth gate, the receipt wall, the content hub entry, and the
// nine restored system fronts - every page the home map links).
const PAGES = ["", "wallet.html", "truth.html", "receipts/", "hub/index.html",
  "net.html", "money.html", "deposits.html", "defi.html", "versus.html",
  "readiness.html", "sovereign.html", "acid.html", "gate.html"];

const FRESH_THRESHOLD_H = 26; // the same life doctrine render.mjs lives by
const FETCH_TIMEOUT_MS = 15000;

// ── SLO & error budget (BENCHMARK.md stage 4) ────────────────────────────────
const SLO_WINDOW_DAYS = 30;
const SLO_DAY_CAP = 35;    // raw daily buckets kept in the file (window is 30)
const SLO_EVENT_CAP = 100; // public burn log, oldest pruned
const SLO_TARGETS = [
  { id: "availability",   gate: "G1-site-up",            target: 0.99 },
  { id: "link-integrity", gate: "G2-zero-broken-links",  target: 0.99 },
  { id: "freshness",      gate: "G3-witness-freshness",  target: 0.99 },
  { id: "moment",        gate: "G10-moment-freshness",  target: 0.99 },
  { id: "heartbeat",      gate: null,                     target: 0.90 },
];
// gate → daily-bucket key (the SLO ledger attributes each gate's own
// PASS/FAIL per run; null = cadence-only targets like the heartbeat)
const GATE_KEYS = {
  "G1-site-up": "g1",
  "G2-zero-broken-links": "g2",
  "G3-witness-freshness": "g3",
  "G10-moment-freshness": "moment",
};
// A moment reading older than this is a broken cadence promise (the agent
// publishes every 30 minutes; routine GitHub cron delays of 5-15 minutes
// are absorbed four times over before this fires).
const MOMENT_MAX_AGE_H = 2;
// The engine mirrors the pages serve (grid/world) carry the same freshness
// doctrine as the witness line: a beat older than 26h is a dead pipeline.
const MIRROR_MAX_AGE_H = 26;
// The weave books (mirror.json, saos-live.json) are served from this home
// through the weave-mirror machine (hourly :57, keyless) which refreshes
// them from the live Console home - where the sovereign heart publishes.
// They may lag their source by one mirror cycle plus routine cron delay;
// a larger lag means the mirror is broken while the network moved on (the
// standing defect the founding inspector measured: books frozen at the
// port, 17h stale, served as current - INS-R65-001 F-2 / OL-13).
const WEAVE_MIRROR_MAX_LAG_H = 2;
const TWIN_BASE = "https://roshpinacare-sys.github.io/Console";

const startedAt = Date.now();
const results = [];
function record(gate, status, measured, note) {
  results.push({ gate, status, measured: String(measured), note: note || "", at: new Date().toISOString() });
  const sym = status === "PASS" ? "PASS" : status === "SKIP" ? "skip" : status;
  console.log(`[${sym}] ${gate} · ${measured}${note ? " · " + note : ""}`);
}

async function fetchUrl(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: "follow", signal: ctrl.signal });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (err) {
    return { ok: false, status: 0, text: "", error: String((err && err.message) || err) };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, timeoutMs) {
  const r = await fetchUrl(url, timeoutMs);
  if (!r.text) return r;
  try { r.json = JSON.parse(r.text); } catch { r.json = null; }
  return r;
}

function hoursBetween(a, b) { return Math.abs(new Date(b) - new Date(a)) / 36e5; }

// ── SLO ledger helpers ───────────────────────────────────────────────────────
function dayKeyUTC(ms) { return new Date(ms).toISOString().slice(0, 10); }
function dayStartUTC(dateStr) { return new Date(dateStr + "T00:00:00.000Z").getTime(); }

// Expected scheduled runs for a calendar date (hourly cadence): bounded by
// the machine's birth on its first day, and by "now" on the current day.
function expectedRunsOn(dateStr, dataSinceMs, nowMs) {
  const from = Math.max(dayStartUTC(dateStr), dataSinceMs);
  const dayEnd = dayStartUTC(dateStr) + 86400000 - 1;
  const to = Math.min(dayEnd, nowMs);
  if (to <= from) return 0;
  return Math.max(1, Math.ceil((to - from) / 36e5));
}

function loadSloLedger() {
  try {
    const s = JSON.parse(fs.readFileSync(SLO_PATH, "utf8"));
    if (s && s.format === "slo-v1" && Array.isArray(s.days) && Array.isArray(s.events)) return s;
  } catch { /* fresh start */ }
  return { format: "slo-v1", days: [], events: [] };
}

function blankDay(date) {
  return { date, runs: 0, allGreen: 0, g1Pass: 0, g1Runs: 0, g2Pass: 0, g2Runs: 0, g3Pass: 0, g3Runs: 0, momentPass: 0, momentRuns: 0 };
}
function bucketFor(days, date) {
  let b = days.find((x) => x.date === date);
  if (!b) { b = blankDay(date); days.push(b); }
  // normalize buckets written before a gate existed (old ledgers lack the
  // newer keys - undefined + 1 would poison the window with NaN)
  for (const k of Object.values(GATE_KEYS)) {
    if (typeof b[k + "Pass"] !== "number") b[k + "Pass"] = 0;
    if (typeof b[k + "Runs"] !== "number") b[k + "Runs"] = 0;
  }
  return b;
}

(async () => {
  console.log(`truth-gate-ci · ${new Date().toISOString()} · target ${BASE}\n`);

  // ── G1: the public site is up ─────────────────────────────────────
  const home = await fetchUrl(BASE + "/");

  // ── PRE-LIVE: the home is pushed, Pages is not enabled yet ────────
  // The single operator action this home waits for is Settings > Pages >
  // Deploy from a branch > main > root. Until it happens, measuring the
  // live site is measuring a 404 that nobody can visit. An honest
  // PRE-LIVE verdict is recorded instead: never ALL-GREEN, never a
  // false red, always timestamped with the exact instruction. A 404
  // AFTER any live measurement is a real outage and stays RED - only a
  // site that was never once alive can be PRE-LIVE.
  let everLive = false;
  try {
    const h = JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8"));
    // bornAt is written once by the first LIVE run and never erased, so a
    // long outage that ages a live verdict out of the capped runs array can
    // never turn a true outage back into a PRE-LIVE amber.
    everLive = Boolean(h.bornAt) || (h.runs || []).some((r) => r && r.verdict && r.verdict !== "PRE-LIVE");
  } catch { /* first run - no history yet */ }
  // PRE-LIVE fires ONLY on the definitive 404 (GitHub Pages "no site"). Any
  // other failure before birth (5xx, network error) is measured for real -
  // the same conservative doctrine the verifier uses.
  if (home.status === 404 && !everLive) {
    const at = new Date().toISOString();
    const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null;
    const report = {
      format: "truth-gate-v1",
      runner: "github-actions",
      at,
      target: BASE,
      verdict: "PRE-LIVE",
      preLive: {
        reason: `site unreachable (HTTP ${home.status}) and never measured live - the expected state is GitHub Pages not enabled yet; one operator action: Settings > Pages > Deploy from a branch > main > root`,
        siteStatus: `HTTP ${home.status}`,
        instruction: "Once Pages serves the site, the next hourly run measures it for real; a failure after any live run is a true outage (RED).",
      },
      counts: { pass: 0, fail: 0, skip: 1 },
      durationMs: Date.now() - startedAt,
      runUrl,
      results: [
        { gate: "G1-site-up", status: "SKIP", measured: `HTTP ${home.status} · pre-live`, note: "site never served yet; operator Pages action pending" },
      ],
    };
    fs.writeFileSync(LATEST_PATH, JSON.stringify(report, null, 2) + "\n");
    // pre-live SLO ledger: the same public shape, zero live measurements.
    // Written so the verdict commit (git add truth/*.json) always has all
    // three files, and so the SLO page shows its honest state before birth.
    const preSlo = {
      format: "slo-v1",
      generatedAt: at,
      generator: "truth-gate-ci",
      preLive: {
        reason: "GitHub Pages is not enabled yet - the SLO ledger starts with the first LIVE measurement.",
        since: at,
      },
      dataSince: null,
      windowDays: SLO_WINDOW_DAYS,
      targets: SLO_TARGETS.map((t) => ({ id: t.id, gate: t.gate || "hourly cadence", target: t.target })),
      window: { daysCounted: 0, runs: 0, allGreen: 0, expectedRuns: 0, fillPct: 0 },
      slos: SLO_TARGETS.map((t) => ({
        id: t.id,
        gate: t.gate || "cadence",
        target: `${(t.target * 100).toFixed(0)}%`,
        measured: null,
        good: 0,
        total: 0,
        budgetAllowed: 0,
        budgetConsumedPct: 0,
        state: "WARMING",
      })),
      days: [],
      events: [],
    };
    fs.writeFileSync(SLO_PATH, JSON.stringify(preSlo, null, 2) + "\n");
    let history = { format: "truth-gate-history-v1", runs: [] };
    try { history = JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8")); } catch { /* first run */ }
    if (!Array.isArray(history.runs)) history.runs = [];
    history.runs.push({ at, verdict: "PRE-LIVE", pass: 0, fail: 0, skip: 1, runUrl });
    if (history.runs.length > HISTORY_CAP) history.runs = history.runs.slice(-HISTORY_CAP);
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + "\n");
    console.log(`VERDICT: PRE-LIVE · HTTP ${home.status} · Pages not enabled yet (operator action) · verdict recorded honestly`);
    process.exitCode = 0;
    return;
  }

  const homeBytes = home.text ? Buffer.byteLength(home.text) : 0;
  record("G1-site-up", home.ok ? "PASS" : "FAIL", `HTTP ${home.status} · ${homeBytes} bytes`);

  // ── G2: zero broken links across the current generation ───────────
  const broken = [], blocked = [];
  let checked = 0;
  const seen = new Set();
  for (const page of PAGES) {
    const pageUrl = page ? `${BASE}/${page}` : `${BASE}/`;
    const ph = page ? await fetchUrl(pageUrl) : home;
    if (!ph.ok || !ph.text) { if (page) broken.push(`${page} page itself: HTTP ${ph.status}`); continue; }
    const base = new URL(pageUrl);
    const hrefs = new Set();
    const re = /href="([^"]*)"/g; let m;
    while ((m = re.exec(ph.text)) !== null) hrefs.add(m[1]);
    for (const h of hrefs) {
      if (!h || h.startsWith("#") || h.startsWith("data:") || h.startsWith("javascript:") ||
          h.startsWith("mailto:") || h.startsWith("tel:")) continue;
      // inline-JS template fragments (href built by string concat) are code, not links
      if (h.includes(String.fromCharCode(39)) || h.includes("+") || h.includes("<")) continue;
      let url;
      try { url = new URL(h, base); } catch { continue; }
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      url.hash = "";
      const key = url.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      checked++;
      const r = await fetchUrl(key, 12000);
      // Same-origin: any non-200 is broken, full stop - we own it.
      // Third-party: 404 (and other 4xx) = definitively broken; 403/5xx/network-0
      // = undetermined (bot walls, origin hiccups) - not proven broken, not blessed.
      const sameOrigin = url.origin === base.origin;
      if (sameOrigin ? !r.ok : (r.ok ? false : !(r.status === 403 || r.status === 0 || r.status >= 500))) {
        broken.push(`${page || "(home)"}: ${h}: HTTP ${r.status}`);
      } else if (!sameOrigin && !r.ok) {
        blocked.push(`${page || "(home)"}: ${h} (${r.status})`);
      }
    }
  }
  record("G2-zero-broken-links",
    home.ok ? (broken.length === 0 ? "PASS" : "FAIL") : "SKIP",
    `${PAGES.length} pages · ${checked} links · ${broken.length} broken · ${blocked.length} undetermined`,
    broken.join(" | "));

  // ── G3: witness freshness on the deployed site ────────────────────
  const depStatus = await fetchJson(BASE + "/status.json");
  if (depStatus.json && depStatus.json.generatedAt) {
    const ageH = hoursBetween(depStatus.json.generatedAt, new Date());
    const thr = (depStatus.json.freshness && depStatus.json.freshness.thresholdHours) || 26;
    record("G3-witness-freshness", ageH <= thr ? "PASS" : "FAIL",
      `cp#${depStatus.json.witness && depStatus.json.witness.checkpoint} · att ${depStatus.json.witness && depStatus.json.witness.attestations} · age ${ageH.toFixed(1)}h (threshold ${thr}h)`);
  } else record("G3-witness-freshness", "FAIL", `status.json unreadable (HTTP ${depStatus.status})`);

  // ── G10: the moment agent is alive (a fresh read of the market) ────
  // The moment agent publishes its reading every 30 minutes. A reading
  // older than MOMENT_MAX_AGE_H means the cadence promise is broken - a
  // dead agent must never hide behind a green site. (GitHub cron delays
  // of 5-15 minutes are routine and absorbed.)
  const momentState = await fetchJson(BASE + "/moment/moment.json");
  if (momentState.json && momentState.json.publishedAt) {
    const mAgeH = hoursBetween(momentState.json.publishedAt, new Date());
    const mOk = mAgeH <= MOMENT_MAX_AGE_H;
    record("G10-moment-freshness", mOk ? "PASS" : "FAIL",
      `age ${mAgeH.toFixed(2)}h (threshold ${MOMENT_MAX_AGE_H}h) · regime ${momentState.json.regime && momentState.json.regime.label || "?"} · call ${momentState.json.call || "none"}`,
      mOk ? "" : `moment-watch cadence broken - the published promise is a fresh reading every 30 minutes (Domain/actions/workflows/moment-watch.yml)`);
  } else record("G10-moment-freshness", "FAIL", `moment/moment.json unreadable (HTTP ${momentState.status}) - the AWARENESS agent's output is a served file, not a nice-to-have`);

  // ── G11: the engine mirrors the site serves are fresh ─────────────
  // The money and defi fronts render the engine's book (grid.json) and
  // world state (world.json) from this repository's dex/ mirror. A frozen
  // mirror shows visitors yesterday's book as if it were live - the
  // deepest kind of lie a data site can tell. Same 26h doctrine as the
  // witness line: a beat older than that is a dead pipeline, not a delay.
  {
    const mirrorAges = {};
    let mirrorOk = true, mirrorNotes = [];
    for (const mf of ["grid.json", "world.json"]) {
      const r = await fetchJson(`${BASE}/dex/${mf}`);
      if (r.json && r.json.publishedAt) {
        const aH = hoursBetween(r.json.publishedAt, new Date());
        mirrorAges[mf] = aH;
        if (!(aH <= MIRROR_MAX_AGE_H)) { mirrorOk = false; mirrorNotes.push(`${mf} age ${aH.toFixed(1)}h > ${MIRROR_MAX_AGE_H}h`); }
      } else { mirrorOk = false; mirrorNotes.push(`${mf} unreadable (HTTP ${r.status})`); }
    }
    record("G11-mirror-freshness", mirrorOk ? "PASS" : "FAIL",
      `grid ${mirrorAges["grid.json"] != null ? mirrorAges["grid.json"].toFixed(1) + "h" : "?"} · world ${mirrorAges["world.json"] != null ? mirrorAges["world.json"].toFixed(1) + "h" : "?"} (threshold ${MIRROR_MAX_AGE_H}h)`,
      mirrorOk ? "" : mirrorNotes.join(" | ") + " - the dex-mirror machine (hourly :52) keeps these served books honest");
  }

  // ── G12: the weave books this home serves are fresh and true ──────
  // (OL-13, found standing by the founding inspector - INS-R65-001 F-2):
  // mirror.json and saos-live.json were ported once at this home's birth
  // and then frozen - the home served yesterday's network state as if it
  // were now, while the Console home served the fresh book. The cure is
  // twofold, delivered together: the weave-mirror machine (hourly :57,
  // keyless) refreshes both books from the live Console mirror, and this
  // gate keeps the served result honest on two axes:
  //   1. local age - the same 26h dead-pipeline doctrine as G3/G11. A
  //      dead heart fails this on both homes at once.
  //   2. twin agreement - the served book may lag the Console home (where
  //      the sovereign heart publishes) by at most WEAVE_MIRROR_MAX_LAG_H:
  //      one mirror cycle plus routine cron delay. A larger lag means the
  //      mirror is broken and this home serves a book the network already
  //      replaced - red within hours, not within a day.
  {
    const weaveAges = {}, weaveLags = {};
    let weaveOk = true; const weaveNotes = [];
    for (const wf of ["mirror.json", "saos-live.json"]) {
      const loc = await fetchJson(`${BASE}/${wf}`);
      const src = await fetchJson(`${TWIN_BASE}/${wf}`);
      if (loc.json && loc.json.generatedAt) {
        const aH = hoursBetween(loc.json.generatedAt, new Date());
        weaveAges[wf] = aH;
        if (!(aH <= MIRROR_MAX_AGE_H)) { weaveOk = false; weaveNotes.push(`${wf} age ${aH.toFixed(1)}h > ${MIRROR_MAX_AGE_H}h (dead pipeline)`); }
      } else if (loc.json) { weaveOk = false; weaveNotes.push(`${wf} served but carries no parseable generatedAt`); }
      else { weaveOk = false; weaveNotes.push(`${wf} unreadable (HTTP ${loc.status})`); }
      if (src.json && src.json.generatedAt && loc.json && loc.json.generatedAt) {
        const lagH = hoursBetween(src.json.generatedAt, loc.json.generatedAt);
        weaveLags[wf] = lagH;
        if (!(lagH <= WEAVE_MIRROR_MAX_LAG_H)) { weaveOk = false; weaveNotes.push(`${wf} lags the Console home by ${lagH.toFixed(1)}h > ${WEAVE_MIRROR_MAX_LAG_H}h (broken mirror)`); }
      } else if (!src.json || !src.json.generatedAt) { weaveOk = false; weaveNotes.push(`${wf} twin carries no parseable generatedAt (HTTP ${src.status}) - freshness cannot be corroborated`); }
    }
    const fmt = (m) => (m != null ? m.toFixed(1) + "h" : "?");
    record("G12-weave-books-freshness", weaveOk ? "PASS" : "FAIL",
      `mirror ${fmt(weaveAges["mirror.json"])} (lag ${fmt(weaveLags["mirror.json"])}) · saos-live ${fmt(weaveAges["saos-live.json"])} (lag ${fmt(weaveLags["saos-live.json"])}) · thresholds ${MIRROR_MAX_AGE_H}h/${WEAVE_MIRROR_MAX_LAG_H}h`,
      weaveOk ? "" : weaveNotes.join(" | ") + " - the weave-mirror machine (hourly :57) keeps these served books honest");
  }

  // ── G5: the reserved name means exactly one format ────────────────
  const depLive = await fetchJson(BASE + "/saos-live.json");
  if (depLive.json) {
    const ok = depLive.json.format === "saos-live-v1";
    record("G5-live-format-consistency", ok ? "PASS" : "FAIL",
      `public book format="${depLive.json.format}"${ok ? "" : " (expected saos-live-v1)"}`);
  } else record("G5-live-format-consistency", "FAIL", `saos-live.json unreadable (HTTP ${depLive.status})`);

  // ── G6: the bridgehead is present and sane ────────────────────────
  const bridge = await fetchJson(BASE + "/agent/state.json");
  if (bridge.json) {
    const ok = bridge.json.format === "agent-bridgehead-state-v1";
    record("G6-bridgehead-sane", ok ? "PASS" : "FAIL",
      `format="${bridge.json.format}"${bridge.json.currentTask ? " · phase task present" : " · no task"}`,
      ok ? "" : "expected agent-bridgehead-state-v1");
  } else record("G6-bridgehead-sane", "FAIL", `agent/state.json unreadable (HTTP ${bridge.status})`);

  // ── G8: the complete map (R61) ─────────────────────────────────────
  const mapFailures = [];
  const pageBytes = {};
  for (const p of SYSTEM_PAGES) {
    const r = await fetchUrl(`${BASE}/${p}`);
    if (!r.ok || !r.text) { mapFailures.push(`${p}: HTTP ${r.status}`); continue; }
    const bytes = Buffer.byteLength(r.text);
    pageBytes[p] = bytes;
    if (bytes <= SYSTEM_MIN_BYTES) { mapFailures.push(`${p}: ${bytes}B <= ${SYSTEM_MIN_BYTES}B`); continue; }
    if (r.text.includes(`content="0; url=${STUB_REDIRECT_TO}"`)) { mapFailures.push(`${p}: still serves the redirect stub`); continue; }
    if (!/<title>[^<]*SAOS/.test(r.text)) { mapFailures.push(`${p}: no SAOS title`); continue; }
  }
  const indexText = home.text || "";
  const unlinked = SYSTEM_PAGES.filter(p => !indexText.includes(`href="${p}"`));
  const truthLinked = indexText.includes('href="truth.html"');
  const sitemap = await fetchUrl(BASE + "/sitemap.xml");
  const sitemapOk = sitemap.ok && !!sitemap.text;
  const unmapped = sitemapOk ? SYSTEM_PAGES.filter(p => !sitemap.text.includes(`/${p}`)) : SYSTEM_PAGES;
  const roast = await fetchUrl(`${BASE}/roast.html`);
  const roastBytes = roast.text ? Buffer.byteLength(roast.text) : 0;
  const roastOk = roast.ok && roast.text &&
    roastBytes <= STUB_MAX_BYTES &&
    roast.text.includes(`content="0; url=${STUB_REDIRECT_TO}"`) &&
    roast.text.includes('rel="canonical"');
  const artifacts = await fetchUrl(`${BASE}/hub/docs/reports/`);
  const artifactsGone = !artifacts.ok && artifacts.status === 404;
  const g8ok = mapFailures.length === 0 && unlinked.length === 0 && unmapped.length === 0 &&
    truthLinked && roastOk && artifactsGone;
  record("G8-complete-map", g8ok ? "PASS" : "FAIL",
    `${SYSTEM_PAGES.length} system pages (min ${SYSTEM_MIN_BYTES}B) · index links ${SYSTEM_PAGES.length - unlinked.length}/${SYSTEM_PAGES.length} · sitemap ${sitemapOk ? SYSTEM_PAGES.length - unmapped.length + "/" + SYSTEM_PAGES.length : "?"} · roast stub ${roastOk ? "ok" : "BROKEN"} · hub/docs/reports ${artifactsGone ? "404 (banned, as required)" : "HTTP " + artifacts.status + " (still served)"}`,
    [mapFailures.join(" | "), unlinked.length ? "not linked from home: " + unlinked.join(" | ") : "", unmapped.length ? "not in sitemap: " + unmapped.join(" | ") : "", roastOk ? "" : "roast stub broken", artifactsGone ? "" : "hub/docs/reports/ not 404"].filter(Boolean).join(" || "));

  // ── sandbox-only gates: recorded honestly as SKIP ─────────────────
  record("G4-no-forged-twins", "SKIP", "sandbox-only (sovereign machine: scripts/benchmark-truth.cjs)");
  record("G7-dev-server", "SKIP", "sandbox-only (the work server is not public infrastructure)");

  // ── verdict of the measured gates (the SLO block below adds G9) ───
  const fail0 = results.filter(r => r.status === "FAIL").length;
  const verdict = fail0 === 0 ? "ALL-GREEN" : `${fail0} RED`;

  // ── history: load BEFORE the SLO ledger (the bootstrap reads it;
  //    this run is appended only afterwards - never counted twice) ───
  let history = { format: "truth-gate-history-v1", runs: [] };
  try { history = JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8")); } catch { /* first run */ }
  if (!Array.isArray(history.runs)) history.runs = [];

  // ── SLO & error budget (stage 4) ─────────────────────────────────
  const now = new Date();
  const slo = loadSloLedger();
  const prevStates = {};
  for (const s of (slo.slos || [])) prevStates[s.id] = s.state;

  // dataSince: the machine's public birth - the first recorded run ever.
  // Never rewritten once set, so the window fill only grows. PRE-LIVE
  // heartbeats (Pages not enabled yet) are machine liveness, not service
  // measurements - the service's birth is its first LIVE measurement.
  const firstLiveRun = history.runs.find((r) => r && r.verdict && r.verdict !== "PRE-LIVE");
  if (!slo.dataSince) slo.dataSince = firstLiveRun ? firstLiveRun.at : now.toISOString();
  const dataSinceMs = Date.parse(slo.dataSince);

  // fresh start: seed the daily buckets from the raw history we still hold.
  // ALL-GREEN runs attribute to every gate (that is what the verdict means);
  // red runs of the pre-SLO era stay unattributed - which gate failed is
  // unknown and will not be guessed here.
  if (!slo.days.length && history.runs.length) {
    for (const r of history.runs) {
      if (!r || !r.at) continue;
      if (r.verdict === "PRE-LIVE") continue; // heartbeat of an unborn service - not an SLI sample
      const b = bucketFor(slo.days, dayKeyUTC(Date.parse(r.at)));
      b.runs++;
      if (r.verdict === "ALL-GREEN") {
        b.allGreen++; b.g1Pass++; b.g1Runs++; b.g2Pass++; b.g2Runs++; b.g3Pass++; b.g3Runs++;
      }
    }
  }

  // this run's contribution to today's bucket (gate-level truth, first hand)
  {
    const b = bucketFor(slo.days, dayKeyUTC(now.getTime()));
    b.runs++;
    if (verdict === "ALL-GREEN") b.allGreen++;
    for (const t of SLO_TARGETS) {
      if (!t.gate) continue;
      const k = GATE_KEYS[t.gate];
      if (!k) continue;
      const g = results.find(r => r.gate === t.gate);
      if (!g) continue;
      if (g.status === "PASS") { b[k + "Pass"]++; b[k + "Runs"]++; }
      else if (g.status === "FAIL") { b[k + "Runs"]++; }
      // SKIP (G2 while the site is down): unattributed for this gate this run
    }
  }

  // trailing window: 30 calendar days, gap-filled - a day with no bucket is
  // a day the machine did not answer, and it still consumes its expectation.
  const windowDates = [];
  for (let i = SLO_WINDOW_DAYS - 1; i >= 0; i--) {
    const d = dayKeyUTC(now.getTime() - i * 86400000);
    if (dayStartUTC(d) >= dayStartUTC(dayKeyUTC(dataSinceMs))) windowDates.push(d);
  }
  const w = { daysCounted: windowDates.length, runs: 0, allGreen: 0, expected: 0, hbGood: 0,
              g1Pass: 0, g1Runs: 0, g2Pass: 0, g2Runs: 0, g3Pass: 0, g3Runs: 0,
              momentPass: 0, momentRuns: 0 };
  for (const d of windowDates) {
    const b = slo.days.find((x) => x.date === d) || blankDay(d);
    const exp = expectedRunsOn(d, dataSinceMs, now.getTime());
    w.expected += exp;
    w.runs += b.runs || 0;
    w.allGreen += b.allGreen || 0;
    w.hbGood += Math.min(b.runs || 0, exp); // extra runs never inflate the heartbeat
    w.g1Pass += b.g1Pass || 0; w.g1Runs += b.g1Runs || 0;
    w.g2Pass += b.g2Pass || 0; w.g2Runs += b.g2Runs || 0;
    w.g3Pass += b.g3Pass || 0; w.g3Runs += b.g3Runs || 0;
    w.momentPass += b.momentPass || 0; w.momentRuns += b.momentRuns || 0;
  }

  const fillPct = Math.min(100, ((now.getTime() - dataSinceMs) / (SLO_WINDOW_DAYS * 86400000)) * 100);
  const slosOut = SLO_TARGETS.map((t) => {
    let good, total;
    if (t.gate === "G1-site-up") { good = w.g1Pass; total = w.g1Runs; }
    else if (t.gate === "G2-zero-broken-links") { good = w.g2Pass; total = w.g2Runs; }
    else if (t.gate === "G3-witness-freshness") { good = w.g3Pass; total = w.g3Runs; }
    else if (t.gate === "G10-moment-freshness") { good = w.momentPass; total = w.momentRuns; }
    else { good = w.hbGood; total = w.expected; }
    const measured = total > 0 ? good / total : null;
    const allowed = total * (1 - t.target);
    const bad = total - good;
    const consumed = allowed > 0 ? (bad / allowed) * 100 : bad > 0 ? Infinity : 0;
    const state = consumed > 100 ? "BREACHED" : fillPct < 100 ? "WARMING" : "OK";
    return {
      id: t.id, gate: t.gate || "cadence",
      target: `${(t.target * 100).toFixed(0)}%`,
      measured: measured === null ? null : +(measured * 100).toFixed(2),
      good, total,
      budgetAllowed: +allowed.toFixed(2),
      budgetConsumedPct: consumed === Infinity ? null : +consumed.toFixed(2),
      state,
    };
  });

  // burn log: budget breaches and recoveries are public events, never erased
  for (const s of slosOut) {
    const prev = prevStates[s.id];
    const how = `consumed ${s.budgetConsumedPct === null ? "inf" : s.budgetConsumedPct + "%"} · ${s.total - s.good} bad of ${s.total} attributed runs`;
    if (s.state === "BREACHED" && prev !== "BREACHED")
      slo.events.push({ at: now.toISOString(), slo: s.id, type: "BUDGET-BREACH", detail: how });
    if (s.state !== "BREACHED" && prev === "BREACHED")
      slo.events.push({ at: now.toISOString(), slo: s.id, type: "BUDGET-RECOVERED", detail: how });
  }
  if (slo.events.length > SLO_EVENT_CAP) slo.events = slo.events.slice(-SLO_EVENT_CAP);

  slo.generatedAt = now.toISOString();
  slo.generator = "truth-gate-ci";
  // R65: a live ledger must carry no pre-live residue. The loadSloLedger
  // carry-forward preserved the dead "Pages not enabled yet" block forever
  // after birth - a false statement about the present, regenerated hourly
  // in a public served file (found standing: dataSince 02:47Z live while
  // preLive.reason still claimed the site never served). The birth is
  // recorded where it belongs: dataSince + history.bornAt. Delivered with
  // assertion A68 (slo_ledger_consistency) so the residue can never return.
  delete slo.preLive;
  slo.windowDays = SLO_WINDOW_DAYS;
  slo.targets = SLO_TARGETS.map((t) => ({ id: t.id, gate: t.gate || "hourly cadence", target: t.target }));
  slo.window = { daysCounted: w.daysCounted, runs: w.runs, allGreen: w.allGreen,
                 expectedRuns: w.expected, fillPct: +fillPct.toFixed(1) };
  slo.slos = slosOut;
  slo.days.sort((a, b) => (a.date < b.date ? -1 : 1));
  slo.days = slo.days.slice(-SLO_DAY_CAP);
  fs.writeFileSync(SLO_PATH, JSON.stringify(slo, null, 2) + "\n");

  // ── G9: the SLO ledger is published and sane (read-back) ──────────
  let g9ok = false, g9m = "slo.json unreadable";
  try {
    const v = JSON.parse(fs.readFileSync(SLO_PATH, "utf8"));
    g9ok = v.format === "slo-v1" && Array.isArray(v.targets) && v.targets.length === SLO_TARGETS.length &&
           Array.isArray(v.slos) && v.slos.length === SLO_TARGETS.length &&
           Array.isArray(v.days) && v.days.length >= 1 &&
           typeof v.dataSince === "string" && typeof v.generatedAt === "string" &&
           v.window && typeof v.window.fillPct === "number";
    g9m = g9ok
      ? `${v.slos.length} SLOs · window ${v.windowDays}d · ${v.days.length} day buckets · fill ${v.window.fillPct}% · since ${String(v.dataSince).slice(0, 10)}`
      : "slo.json malformed after write";
  } catch (e) { g9m = "slo.json unreadable: " + String((e && e.message) || e); }
  record("G9-slo-published", g9ok ? "PASS" : "FAIL", g9m);

  // ── final counts (G9 included) + report ──────────────────────────
  const passAll = results.filter(r => r.status === "PASS").length;
  const failAll = results.filter(r => r.status === "FAIL").length;
  const skipAll = results.filter(r => r.status === "SKIP").length;
  const finalVerdict = failAll === 0 ? "ALL-GREEN" : `${failAll} RED`;

  const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;

  const report = {
    format: "truth-gate-v1",
    runner: "github-actions",
    at: new Date().toISOString(),
    target: BASE,
    verdict: finalVerdict,
    counts: { pass: passAll, fail: failAll, skip: skipAll },
    durationMs: Date.now() - startedAt,
    runUrl,
    results,
  };
  fs.writeFileSync(LATEST_PATH, JSON.stringify(report, null, 2) + "\n");

  // history: append one line per run, cap the list, prune the oldest.
  // bornAt: set once by the first LIVE run, outside the capped array.
  if (verdict !== "PRE-LIVE" && !history.bornAt) history.bornAt = report.at;
  history.runs.push({ at: report.at, verdict: finalVerdict, pass: passAll, fail: failAll, skip: skipAll, runUrl });
  if (history.runs.length > HISTORY_CAP) history.runs = history.runs.slice(-HISTORY_CAP);
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + "\n");

  console.log(`\nVERDICT: ${finalVerdict} · ${passAll} PASS · ${failAll} FAIL · ${skipAll} SKIP · ${report.durationMs}ms`);
  console.log(`wrote: truth/latest.json · truth/history.json (${history.runs.length} runs) · truth/slo.json (fill ${slo.window.fillPct}%)`);
  process.exitCode = failAll === 0 ? 0 : 1;
})().catch((err) => {
  console.error("truth-gate-ci crashed:", err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
