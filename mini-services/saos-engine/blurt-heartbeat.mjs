/**
 * blurt-heartbeat.mjs — R313 · THE BLURT BODIES PROBE (read-only, public RPC,
 * zero keys, zero spend).
 *
 * OPERATOR QUESTION (2026-10-11): "אני רואה בסנדבוקס שהחשבונות blurt לא
 * מחוברים למרות שיש לנו אותם בכספות" — the bodies read "not connected" while
 * the vault holds their keys.
 *
 * THE MEASURED TRUTH (R267, 2026-10-08, state/r267-blurt-fleet.json):
 * 11/12 blurt bodies are FULL-ACCESS (every role's WIF matches the live
 * authority); `ynet` holds no blurt keys. The bodies were never BROKEN — they
 * were INVISIBLE: no heartbeat step ever showed blurt, so the operator saw a
 * silent wing and read it as "not connected". The SPEND pause (R254, operator
 * law: "לגבי blurt תמתין") stands untouched — visibility is not spend.
 *
 * WHAT THIS MODULE DOES: one public-RPC read per heartbeat (existence, stake,
 * balance, last-post age — public data only), verdict into the heartbeat
 * report, state written to state/blurt-bodies.json. Zero key material is ever
 * touched; this module cannot broadcast even by accident (no signer import).
 *
 * LAWS: R254 spend-pause stands · fail-soft (an unreachable RPC is a verdict,
 * never a crash) · R275 isolation (SAOS_STATE_DIR honored for selftest).
 */

import * as fs from "node:fs";
import * as path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const stateDir = () => process.env.SAOS_STATE_DIR || path.join(DIR, "state");

export const BLURT_NODES = ["https://blurt-rpc.saboin.com", "https://rpc.blurt.world"];
/* R267 fleet universe (11 FULL-ACCESS + ynet NO-ACCESS = 12 bodies) */
export const BLURT_FALLBACK_NAMES = [
  "headcorner", "cashmachine", "haran", "israelnews", "lsa", "macrame",
  "siq", "tov", "wic", "wog", "woq", "ynet",
];

const DAY_MS = 86_400_000;

/* ── pure (selftest-locked): condenser rows → per-body verdicts ──────────── */
export function parseBodies(rows, names, nowMs = Date.now()) {
  const by = new Map((Array.isArray(rows) ? rows : []).map((r) => [String(r?.name ?? ""), r]));
  const accounts = [];
  let live = 0;
  for (const n of names) {
    const r = by.get(n);
    if (!r || !r.name) { accounts.push({ name: n, exists: false }); continue; }
    const last = Date.parse(String(r.last_post_update ?? "") || "invalid");
    const days = Number.isFinite(last) ? Math.max(0, Math.floor((nowMs - last) / DAY_MS)) : null;
    const vests = parseFloat(String(r.vesting_shares ?? "0"));
    if (Number.isFinite(vests) && vests > 0) live += 1;
    accounts.push({
      name: n,
      exists: true,
      vests: String(r.vesting_shares ?? "").trim() || null,
      balance: String(r.balance ?? "").trim() || null,
      lastPostDaysAgo: days,
    });
  }
  return { live, total: names.length, accounts };
}

function readJson(p, d = null) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } }
function writeJson(p, v) { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); }

/* fleet names: the R267 verdict file is the source of truth when present */
function blurtNames() {
  const r267 = readJson(path.join(stateDir(), "r267-blurt-fleet.json"), null);
  const names = (Array.isArray(r267?.accounts) ? r267.accounts : []).map((a) => String(a?.account ?? "")).filter(Boolean);
  return names.length ? names : BLURT_FALLBACK_NAMES;
}

async function blurtRpc(node, method, params, timeoutMs = 15000) {
  const r = await fetch(node, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const j = await r.json();
  if (j.error) throw new Error(String(j.error?.message ?? "rpc-error").slice(0, 120));
  return j.result;
}

/* ── the probe: read-only, one heartbeat call ────────────────────────────── */
export async function runBlurtBodies({ now = new Date().toISOString() } = {}) {
  const t0 = Date.now();
  const names = blurtNames();
  let rows = null, node = null, error = null;
  for (const n of BLURT_NODES) {
    try { rows = await blurtRpc(n, "condenser_api.get_accounts", [names]); node = n; break; }
    catch (e) { error = String(e?.message ?? e).slice(0, 120); }
  }
  let out;
  if (!Array.isArray(rows)) {
    out = { at: now, verdict: "BLURT-RPC-UNREACHABLE", error, nodes: BLURT_NODES, live: null, total: names.length, spendGate: "R254-PAUSE-STANDS", law: "visibility is not spend; an unreachable RPC is a verdict, never a crash" };
  } else {
    const p = parseBodies(rows, names, Date.parse(now) || Date.now());
    out = {
      at: now, verdict: p.live > 0 ? "BLURT-BODIES-LIVE" : "BLURT-BODIES-EMPTY", node,
      live: p.live, total: p.total, accounts: p.accounts,
      custodyRef: "R267: 11/12 FULL-ACCESS (2026-10-08, state/r267-blurt-fleet.json)",
      spendGate: "R254-PAUSE-STANDS", ms: Date.now() - t0,
      law: "bodies are visible every beat; the R254 spend pause stands until the operator re-arms it",
    };
  }
  try { writeJson(path.join(stateDir(), "blurt-bodies.json"), out); } catch { /* state never blocks */ }
  return out;
}
