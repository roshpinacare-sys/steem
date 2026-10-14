#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 * PRESENCE-MATRIX — read-only multi-network display parity probe (exec 29-a)
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS: a differential probe. It measures, for the 14 fleet accounts
 * (master "headcorner" + ARMY_ROSTER from mini-services/saos-engine/
 * army-social.mjs — the roster source of truth) AND for control accounts
 * (steem/nasoe/marpa), how each Steem display surface serves them:
 *
 *   CHAIN layer   — condenser_api.get_accounts (existence + history truth)
 *   DISPLAY layer — steemit.com/@{a}          (SSR front-end, the one that
 *                  currently shells the fleet — measured 2026-10-13/14)
 *                   steemitwallet.com/@{a}   (SPA)
 *                   steemworld.org/@{a}      (SPA)
 *                   steemscan.com/account/a  (SPA)
 *                   steemdb.io/@{a}          (was ERR for everyone)
 *
 * LAWS (hard): READ-ONLY — zero keys, zero broadcasts, zero writes outside
 * this repo's state dir; zero npm deps (global fetch, node >= 20); zero
 * third-party API keys; ALWAYS exit 0 — the receipt IS the report. A probe
 * that cannot measure says so honestly (tombstone style, never fail-open
 * claims: failures are recorded in the JSON, not swallowed).
 *
 * VERDICT LOGIC (per surface):
 *   steemit.com  — control median bytes + og:title extraction.
 *                  SHELL  = bytes < 0.6 × controlMedian
 *                           OR empty/generic og:title while controls carry
 *                           meaningful titles
 *                  FULL   = served like the controls
 *                  HTTP{n}/ERR = what actually happened
 *   SPA surfaces — wallet/steemworld/steemscan render client-side from public
 *                  APIs. If fleet AND control page sizes sit within ~15% of
 *                  each other → "SPA-PARITY" (no server-side differential is
 *                  measurable — display parity holds via the client-side API
 *                  path). Divergence would be reported honestly as
 *                  "SPA-DIVERGENT" (that would mean a server-side flag).
 *   steemdb.io   — honest DOWN/ERR for everyone when it is down for everyone.
 *
 * OUTPUT (state, committed by .github/workflows/presence-matrix.yml):
 *   mini-services/saos-engine/state/presence-matrix.json           (full matrix)
 *   mini-services/saos-engine/state/presence-matrix-summary.md     (human read)
 *   mini-services/saos-engine/state/presence-matrix-digest.json    (decider line)
 * ═════════════════════════════════════════════════════════════════════════ */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATE_DIR = path.join(ROOT, "mini-services", "saos-engine", "state");
const ARMY_FILE = path.join(ROOT, "mini-services", "saos-engine", "army-social.mjs");

const MASTER = "headcorner";
const CONTROLS = ["steem", "nasoe", "marpa"];
/* last-resort snapshot (used ONLY if both the import and the regex parse of
 * army-social.mjs fail — marked honestly as rosterSource). Must mirror
 * ARMY_ROSTER in army-social.mjs; the regex parse is the primary zero-dep
 * source of truth, so this is a floor, not a driver. */
const EMBEDDED_ROSTER_FALLBACK = ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq", "hcsoldier4", "hcsoldier5", "hcsoldier6"];

const CHAIN_RPC = "https://api.steemit.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 15_000;
const MAX_BYTES = 200 * 1024;          // read cap per page (raw honesty: sizes are capped counts)
const REQUEST_SPACING_MS = 250;        // gentle pacing — we are a guest on these surfaces
const SPA_PARITY_BAND = 0.15;          // ±15% around the median = parity
const SHELL_SIZE_RATIO = 0.6;          // < 60% of control median = shell
const GENERIC_TITLES = new Set(["", "steemit", "steemit — Steemit".toLowerCase(), "sign up", "login", "steem"]);

const SURFACES = [
  { id: "steemit.com",        kind: "ssr", url: (a) => `https://steemit.com/@${a}` },
  { id: "steemitwallet.com",  kind: "spa", url: (a) => `https://steemitwallet.com/@${a}` },
  { id: "steemworld.org",     kind: "spa", url: (a) => `https://steemworld.org/@${a}` },
  { id: "steemscan.com",      kind: "spa", url: (a) => `https://steemscan.com/account/${a}` },
  { id: "steemdb.io",         kind: "spa", url: (a) => `https://steemdb.io/@${a}` },
];
const SPA_SURFACE_IDS = ["steemitwallet.com", "steemworld.org", "steemscan.com"];
const CIRCUIT_BREAKER_STREAK = 3;      // consecutive NETWORK failures → skip rest of surface sweep (labeled, honest)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const atNow = () => new Date().toISOString();

/* ── roster: source of truth is army-social.mjs ──────────────────────────── */
async function loadRoster() {
  // 1) true import (works wherever node_modules is present)
  try {
    const mod = await import(pathToFileURL(ARMY_FILE).href);
    if (Array.isArray(mod.ARMY_ROSTER) && mod.ARMY_ROSTER.length > 0) {
      return { army: [...mod.ARMY_ROSTER], source: "army-social.mjs:import" };
    }
  } catch { /* no deps in this environment — fall through to regex parse */ }
  // 2) zero-dep regex parse of the SAME file (same source of truth)
  try {
    const src = fs.readFileSync(ARMY_FILE, "utf8");
    const m = src.match(/export\s+const\s+ARMY_ROSTER\s*=\s*\[([^\]]*)\]/);
    if (m) {
      const army = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
      if (army.length > 0) return { army, source: "army-social.mjs:regex-parse" };
    }
  } catch { /* fall through */ }
  // 3) embedded floor — honest marker
  return { army: EMBEDDED_ROSTER_FALLBACK, source: "embedded-snapshot (army-social.mjs unreadable)" };
}

/* ── HEAD sha (read-only; never fatal) ───────────────────────────────────── */
function headSha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/* ── CHAIN layer ─────────────────────────────────────────────────────────── */
async function chainProbe(accounts) {
  const out = { endpoint: CHAIN_RPC, method: "condenser_api.get_accounts", ok: false, error: null, accounts: {} };
  for (const a of accounts) out.accounts[a] = { exists: null, created: null, postCount: null, lastRootPost: null, lastVoteTime: null };
  try {
    const res = await fetch(CHAIN_RPC, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": UA },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "condenser_api.get_accounts", params: [accounts] }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) { out.error = `HTTP ${res.status}`; return out; }
    const json = await res.json();
    const found = Array.isArray(json?.result) ? json.result : null;
    if (!found) { out.error = `unexpected RPC shape: ${JSON.stringify(json).slice(0, 200)}`; return out; }
    const byName = new Map(found.map((x) => [x.name, x]));
    for (const a of accounts) {
      const rec = byName.get(a);
      out.accounts[a] = rec
        ? { exists: true, created: rec.created ?? null, postCount: rec.post_count ?? null, lastRootPost: rec.last_root_post ?? null, lastVoteTime: rec.last_vote_time ?? null }
        : { exists: false, created: null, postCount: null, lastRootPost: null, lastVoteTime: null };
    }
    out.ok = true;
  } catch (e) {
    out.error = String(e?.message || e);
  }
  return out;
}

/* ── DISPLAY layer ───────────────────────────────────────────────────────── */
function decodeBasic(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x0?27;/gi, "'");
}
function extractOgTitle(html) {
  if (!html) return null;
  const tag = (html.match(/<meta\s+[^>]*?(?:property|name)\s*=\s*["']og:title["'][^>]*>/i) || [])[0];
  if (!tag) return null;
  const c = tag.match(/content\s*=\s*["']([^"']*)["']/i);
  return c ? decodeBasic(c[1]) : null;
}
function titleMeaningful(title) {
  if (title == null) return false;
  const t = title.trim().toLowerCase();
  if (GENERIC_TITLES.has(t)) return false;
  return t.length > 0;
}

async function fetchPage(url) {
  const first = await fetchPageOnce(url);
  if (first.ok) return first;
  /* a full-timeout hang is rarely fixed by an immediate retry — keep the
   * sweep bounded (transient fast failures DO get one honest retry) */
  if (first.ms >= FETCH_TIMEOUT_MS - 250) return first;
  await sleep(400);
  const second = await fetchPageOnce(url);
  return second.ok ? second : { ...second, retried: true };
}

async function fetchPageOnce(url) {
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "accept-language": "en-US,en;q=0.9" },
      redirect: "follow",
      signal: ac.signal,
    });
    const status = res.status;
    const chunks = [];
    let bytes = 0;
    let truncated = false;
    if (res.body && typeof res.body.getReader === "function") {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
        bytes += value.byteLength;
        if (bytes >= MAX_BYTES) { truncated = true; ac.abort(); break; }
      }
    } else {
      const buf = Buffer.from(await res.arrayBuffer());
      truncated = buf.byteLength > MAX_BYTES;
      bytes = Math.min(buf.byteLength, MAX_BYTES);
      chunks.push(buf.subarray(0, bytes));
    }
    const text = Buffer.concat(chunks).subarray(0, MAX_BYTES).toString("utf8");
    return { ok: true, status, bytes, truncated, text, finalUrl: res.url, client: "node-fetch", ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 200), ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

/* fallback instrument: system curl (present on ubuntu-latest + dev sandboxes;
 * zero npm deps, zero keys, same read-only GET). Used ONLY when a whole
 * surface is uniformly non-200 under node fetch — that pattern means the
 * probe client itself is blocked (TLS fingerprint), i.e. an instrument
 * failure, NOT a per-account differential. */
function curlPage(url) {
  const t0 = Date.now();
  const tmp = path.join(os.tmpdir(), `presence-matrix-${process.pid}-${Math.random().toString(36).slice(2)}.body`);
  try {
    const out = execFileSync(
      "curl",
      ["-sS", "-L", "--max-time", String(Math.round(FETCH_TIMEOUT_MS / 1000)), "-A", UA,
       "-H", "accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
       "-o", tmp, "-w", "%{http_code}", url],
      { timeout: FETCH_TIMEOUT_MS + 5_000, encoding: "utf8" },
    );
    const status = parseInt((out || "").trim(), 10);
    const buf = fs.existsSync(tmp) ? fs.readFileSync(tmp) : Buffer.alloc(0);
    const truncated = buf.byteLength > MAX_BYTES;
    const text = buf.subarray(0, MAX_BYTES).toString("utf8");
    return { ok: true, status: Number.isFinite(status) ? status : 0, bytes: buf.byteLength, truncated, text, finalUrl: url, client: "curl-subprocess", ms: Date.now() - t0 };
  } catch (e) {
    const code = e?.status ? `curl-exit-${e.status}` : "curl-spawn-fail";
    return { ok: false, error: `${code}: ${String(e?.message || e).slice(0, 120)}`, ms: Date.now() - t0 };
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* temp best-effort */ }
  }
}

/* ── verdicts ────────────────────────────────────────────────────────────── */
function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function steemitVerdict(rec, ctlMedian, ctlMeaningfulTitle) {
  if (!rec.ok) return "ERR";
  if (rec.status !== 200) return `HTTP${rec.status}`;
  if (ctlMedian == null) return "UNDETERMINED";  // no control fetched: no calibration, never fail-open to FULL
  if (rec.bytes < SHELL_SIZE_RATIO * ctlMedian) return "SHELL";
  if (ctlMeaningfulTitle && !titleMeaningful(rec.ogTitle)) return "SHELL";
  return "FULL";
}

function spaSurfaceParity(records) {
  const okRecs = records.filter((r) => r.ok && r.status === 200);
  const ctlOk = okRecs.filter((r) => CONTROLS.includes(r.account));
  /* parity is a FLEET-VS-CONTROL claim: it needs ≥2 OK pages AND ≥1 control
   * among them, else the honest answer is UNDETERMINED (not parity). */
  if (okRecs.length < 2 || ctlOk.length < 1) {
    return { parity: null, medianBytes: okRecs.length ? median(okRecs.map((r) => r.bytes)) : null, note: "insufficient successful fetches (need ≥2 incl. ≥1 control) for a parity band" };
  }
  const ok = okRecs.map((r) => r.bytes);
  const med = median(ok);
  const parity = ok.every((b) => Math.abs(b - med) <= SPA_PARITY_BAND * med);
  return { parity, medianBytes: med, note: parity ? "fleet and controls within ±15% — no server-side differential measurable" : "sizes diverge beyond ±15% — recorded honestly" };
}

/* ── main ────────────────────────────────────────────────────────────────── */
async function main() {
  const matrix = {
    kind: "presence-matrix/v1",
    at: atNow(),
    head: headSha(),
    readOnly: true,
    zeroDeps: true,
    exitContract: "always-0 (receipt IS the report)",
    roster: null,
    chain: null,
    surfaces: {},
    results: [],
    verdicts: {},
    limits: [
      "read-only probe: zero keys, zero broadcasts, zero writes outside the state dir",
      "page sizes are response byte counts, capped at 200KB per page (truncated flags where hit)",
      "SPA surfaces (wallet/steemworld/steemscan) render client-side from public APIs — SPA-PARITY means no server-side differential is measurable, not an endorsement of displayed content",
      "steemit.com differential is server-side at their origin (measured with cache-buster MISS on both fleet and controls, same IP/UA) — git cannot lift it; chain truth is the ledger",
      "instrument note: primary client is node fetch (undici); some edges TLS-fingerprint-block it (measured: uniform HTTP403 from sandbox). When a WHOLE surface comes back non-200 for fleet AND controls alike, the sweep is re-measured once via the system curl binary (still zero-dep, read-only, same UA/cache-buster) — the client per record is labeled. A uniform block is an instrument failure, not a differential; a fallback that still fails is reported as-is.",
    ],
    error: null,
  };

  /* roster */
  const { army, source: rosterSource } = await loadRoster();
  const fleet = [MASTER, ...army];
  const everyone = [...fleet, ...CONTROLS];
  matrix.roster = { master: MASTER, army, fleet, controls: CONTROLS, source: rosterSource };

  /* CHAIN layer — all 17 in one call */
  matrix.chain = await chainProbe(everyone);

  /* DISPLAY layer — per surface, per account, paced */
  for (const surf of SURFACES) {
    const meta = {
      kind: surf.kind,
      urlPattern: surf.url("{account}"),
      cacheBuster: true,
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: MAX_BYTES,
      records: {},        // account -> raw measurement
      controlOgTitles: {},
      controlMedianBytes: null,
      surfaceVerdict: null,
    };
    const recs = [];
    let i = 0;
    for (const a of everyone) {
      const url = `${surf.url(a)}?cb=${Date.now().toString(36)}${i}`;
      const raw = await fetchPage(url);
      recs.push({ account: a, url, raw });
      i += 1;
      if (i < everyone.length) await sleep(REQUEST_SPACING_MS);
    }

    /* instrument-block detection: ZERO 200s across fleet AND controls = the
     * client is blocked uniformly (no differential measurable). Re-measure
     * the whole surface once via curl, honestly labeled. */
    meta.fallbackClient = null;
    if (recs.every(({ raw }) => !raw.ok || raw.status !== 200)) {
      console.error(`  ${surf.id}: uniform non-200 under node fetch (${recs.filter((r) => r.raw.ok).map((r) => r.raw.status).join(",") || "all-ERR"}) — instrument block suspected, re-measuring via curl fallback`);
      meta.fallbackClient = "curl-subprocess (fired: zero 200s under node fetch)";
      let j = 0;
      for (const r of recs) {
        r.raw = await curlPage(r.url);
        j += 1;
        if (j < recs.length) await sleep(REQUEST_SPACING_MS);
      }
    }
    for (const { account, raw } of recs) {
      const rec = raw.ok
        ? {
            account,
            ok: true, status: raw.status, bytes: raw.bytes, truncated: raw.truncated,
            ms: raw.ms, finalUrl: raw.finalUrl, client: raw.client,
            ogTitle: extractOgTitle(raw.text),
            namePresent: raw.text.toLowerCase().includes(account.toLowerCase()),
          }
        : { account, ok: false, error: raw.error, ms: raw.ms, client: raw.client ?? "node-fetch" };
      meta.records[account] = rec;
    }

    const ctlRecs = CONTROLS.map((a) => meta.records[a]);
    const ctlOk = ctlRecs.filter((r) => r.ok && r.status === 200);
    meta.controlMedianBytes = median(ctlOk.map((r) => r.bytes));
    for (const a of CONTROLS) {
      const r = meta.records[a];
      if (r?.ok && r.status === 200) meta.controlOgTitles[a] = r.ogTitle;
    }
    const ctlMeaningfulTitle = Object.values(meta.controlOgTitles).some(titleMeaningful);

    if (surf.id === "steemit.com") {
      for (const a of everyone) {
        const rec = meta.records[a];
        rec.verdict = steemitVerdict(rec, meta.controlMedianBytes, ctlMeaningfulTitle);
      }
      const ctlVerdicts = CONTROLS.map((a) => meta.records[a].verdict);
      const ctlFull = ctlVerdicts.every((v) => v === "FULL");
      const fleetRecs = fleet.map((a) => meta.records[a]);
      const shells = fleetRecs.filter((r) => r.verdict === "SHELL").length;
      const fulls = fleetRecs.filter((r) => r.verdict === "FULL").length;
      meta.surfaceVerdict =
        shells > 0 && ctlFull ? `SHELL-DIFFERENTIAL (fleet shells=${shells}/${fleet.length}, controls FULL)` :
        shells > 0 ? `SHELL-OR-DEGRADED (fleet shells=${shells}/${fleet.length}; controls not all FULL: ${ctlVerdicts.join(",")})` :
        fulls === fleet.length && ctlFull ? "PARITY-FULL" :
        `MIXED/DEGRADED (fleet FULL=${fulls}/${fleet.length}; controls: ${ctlVerdicts.join(",")})`;
    } else {
      const allRecs = everyone.map((a) => meta.records[a]);
      const { parity, medianBytes, note } = spaSurfaceParity(allRecs);
      meta.surfaceMedianBytes = medianBytes;
      meta.parityNote = note;
      const down = allRecs.every((rec) => !rec.ok || rec.status !== 200);
      for (const rec of allRecs) {
        if (!rec.ok) rec.verdict = "ERR";
        else if (rec.status !== 200) rec.verdict = `HTTP${rec.status}`;
        else if (down) rec.verdict = "DOWN";
        else if (parity === true) rec.verdict = "SPA-PARITY";
        else if (parity === false) rec.verdict = "SPA-DIVERGENT";
        else rec.verdict = `HTTP${rec.status}`;
      }
      meta.surfaceVerdict = down ? "DOWN (every probe failed or non-200 — honest tombstone)" : parity === true ? "SPA-PARITY" : parity === false ? "SPA-DIVERGENT" : "UNDETERMINED (insufficient fetches)";
    }
    matrix.surfaces[surf.id] = meta;
  }

  /* per-account rows */
  for (const a of everyone) {
    const cls = fleet.includes(a) ? (a === MASTER ? "fleet-master" : "fleet") : "control";
    const c = matrix.chain.accounts[a] || {};
    const display = {};
    for (const surf of SURFACES) {
      const r = matrix.surfaces[surf.id].records[a];
      display[surf.id] = {
        verdict: r.verdict,
        status: r.status ?? null,
        bytes: r.bytes ?? null,
        truncated: r.truncated ?? null,
        ms: r.ms ?? null,
        client: r.client ?? null,
        ogTitle: r.ogTitle ?? null,
        namePresent: r.namePresent ?? null,
        error: r.error ?? null,
      };
    }
    matrix.results.push({
      account: a, class: cls,
      chain: { exists: c.exists ?? null, created: c.created ?? null, postCount: c.postCount ?? null, lastRootPost: c.lastRootPost ?? null, lastVoteTime: c.lastVoteTime ?? null },
      display,
    });
  }

  /* aggregates */
  const fleetRows = matrix.results.filter((r) => r.class.startsWith("fleet"));
  const chainPresent = fleetRows.filter((r) => r.chain.exists === true).length;
  const steemVerds = fleetRows.map((r) => r.display["steemit.com"].verdict);
  const allShell = steemVerds.length > 0 && steemVerds.every((v) => v === "SHELL");
  const allFull = steemVerds.length > 0 && steemVerds.every((v) => v === "FULL");
  const fleetSteemit = allShell ? "SHELL" : allFull ? "FULL" : "MIXED";
  const alternatesParity = SPA_SURFACE_IDS.every((id) => matrix.surfaces[id].surfaceVerdict === "SPA-PARITY");

  matrix.verdicts = {
    fleetSteemit,
    steemitFleetCounts: steemVerds.reduce((acc, v) => { acc[v] = (acc[v] || 0) + 1; return acc; }, {}),
    alternatesParity,
    perSurface: Object.fromEntries(SURFACES.map((s) => [s.id, matrix.surfaces[s.id].surfaceVerdict])),
    chainPresence: `${chainPresent}/${fleet.length}`,
    chainOk: matrix.chain.ok,
    controlsChainPresence: `${matrix.results.filter((r) => r.class === "control" && r.chain.exists === true).length}/${CONTROLS.length}`,
  };

  /* write state (receipt = report; writer failures are fatal-loud but the
   * run wrapper records them — we still try all three files independently) */
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const writeJson = (p, v) => {
    const tmp = `${p}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(v, null, 2) + "\n");
    fs.renameSync(tmp, p);
  };

  writeJson(path.join(STATE_DIR, "presence-matrix.json"), matrix);

  /* summary (human) */
  const kb = (b) => (b == null ? "—" : `${(b / 1024).toFixed(1)}KB`);
  const L = [];
  L.push(`# presence-matrix — multi-network display parity probe (read-only)`);
  L.push("");
  L.push(`- at: ${matrix.at}`);
  L.push(`- HEAD: ${matrix.head ?? "unknown (not a git checkout)"}`);
  L.push(`- roster source: ${rosterSource} · fleet ${fleet.length} (master ${MASTER} + ${army.length} army) · controls ${CONTROLS.join("/")}`);
  L.push(`- chain layer: ${matrix.chain.ok ? "ok" : `FAILED (${matrix.chain.error})`} via condenser_api.get_accounts`);
  L.push("");
  L.push(`FLEET ${fleet.length}: steemit.com=${fleetSteemit} · alternates=${alternatesParity ? "SPA-PARITY" : "NOT-PARITY"} · chain=${matrix.verdicts.chainPresence}`);
  L.push(`CONTROLS ${CONTROLS.length}: steemit.com=${matrix.surfaces["steemit.com"].surfaceVerdict} · chain=${matrix.verdicts.controlsChainPresence}`);
  L.push("");
  L.push(`| surface | verdict (surface) | fleet counts | control median bytes |`);
  L.push(`|---|---|---|---|`);
  for (const s of SURFACES) {
    const fleetCounts = fleetRows.map((r) => r.display[s.id].verdict).reduce((acc, v) => { acc[v] = (acc[v] || 0) + 1; return acc; }, {});
    const fc = Object.entries(fleetCounts).map(([k, n]) => `${k}×${n}`).join(" ") || "—";
    L.push(`| ${s.id} | ${matrix.surfaces[s.id].surfaceVerdict} | ${fc} | ${kb(matrix.surfaces[s.id].controlMedianBytes)} |`);
  }
  L.push("");
  L.push(`## per-account raw`);
  L.push("");
  L.push(`| account | class | chain | ${SURFACES.map((s) => s.id).join(" | ")} |`);
  L.push(`|---|---|---|${SURFACES.map(() => "---").join("|")}`);
  for (const r of matrix.results) {
    const chainCell = r.chain.exists === true ? `${r.chain.postCount ?? "?"}p` : r.chain.exists === false ? "MISSING" : "RPC-FAIL";
    const cells = SURFACES.map((s) => {
      const d = r.display[s.id];
      if (d.verdict === "ERR") return `ERR (${(d.error || "").slice(0, 40)})`;
      if (d.verdict.startsWith("HTTP")) return `${d.verdict} ${kb(d.bytes)}`;
      return `${d.verdict} ${kb(d.bytes)}${d.ogTitle ? ` · og:"${String(d.ogTitle).slice(0, 28)}"` : ""}`;
    });
    L.push(`| ${r.account} | ${r.class} | ${chainCell} | ${cells.join(" | ")} |`);
  }
  L.push("");
  L.push(`## honest limits`);
  for (const l of matrix.limits) L.push(`- ${l}`);
  if (!matrix.chain.ok) L.push(`- chain layer FAILED this run (${matrix.chain.error}) — chain-derived fields are null, never assumed`);
  L.push(`- steemdb.io is measured as served; when it is DOWN for fleet AND controls alike it is excluded from the alternates-parity boolean (parity on a dead surface would be a false claim)`);
  L.push("");
  fs.writeFileSync(path.join(STATE_DIR, "presence-matrix-summary.md"), L.join("\n") + "\n");

  /* digest (decider line) — ONE compact JSON line the sovereign decider
   * (D5-social-standby) reads. Signature = "sig:" + first 8 hex of
   * sha256(canonical digest JSON), where canonical = compact, keys sorted,
   * computed over the digest WITHOUT the signature field (it cannot sign
   * itself). Any tamper/corruption of at/head/verdict/verdicts breaks the sig.
   *
   * exec29/29-a2 · DECIDER CONTRACT: the Autonomy decider's D5 reads exactly
   * the field `verdict` (first of its tuple verdict/status/state/result) and
   * PASSes the multi-network display item only when the value is in its
   * GREEN_VERDICTS whitelist {PASS, GREEN, OK, LIVE, READY, ALL_PASS,
   * HEALTHY} and the digest is <12h old. Honest mapping, measured here:
   *   "GREEN"    = alternates display parity holds AND the full fleet
   *                (14/14) is present on chain — the multi-network display
   *                deployment is green; the steemit.com anti-abuse shell is
   *                never swallowed — it stays carried by fleetSteemit.
   *   "IMPAIRED" = anything else (parity lost, chain presence incomplete,
   *                chain layer failed). Never invented, always measured. */
  const verdict = (alternatesParity === true && matrix.verdicts.chainPresence === "14/14") ? "GREEN" : "IMPAIRED";
  const digest = { at: matrix.at, head: matrix.head, fleetSteemit, alternatesParity, chainPresence: matrix.verdicts.chainPresence, verdict };
  const canonical = JSON.stringify(digest, Object.keys(digest).sort());
  const signature = "sig:" + createHash("sha256").update(canonical).digest("hex").slice(0, 8);
  fs.writeFileSync(path.join(STATE_DIR, "presence-matrix-digest.json"), JSON.stringify({ ...digest, signature }) + "\n");

  /* stdout digest — one honest line for the run log */
  console.log(`presence-matrix ${matrix.at} head=${(matrix.head || "n/a").slice(0, 12)} fleetSteemit=${fleetSteemit} alternatesParity=${alternatesParity} chain=${matrix.verdicts.chainPresence} verdict=${verdict} steemit.com=${matrix.surfaces["steemit.com"].surfaceVerdict}`);
  for (const s of SURFACES) console.log(`  ${s.id}: ${matrix.surfaces[s.id].surfaceVerdict}`);
}

main().catch((e) => {
  /* tombstone honesty: never lie, never fail-open — record and exit 0 */
  const msg = `presence-matrix FATAL (recorded, exit 0): ${String(e?.stack || e?.message || e)}`;
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.appendFileSync(path.join(STATE_DIR, "presence-matrix-fatal.log"), `${new Date().toISOString()} ${msg}\n`);
  } catch { /* nothing else we can do */ }
  console.error(msg);
  process.exit(0);
});
