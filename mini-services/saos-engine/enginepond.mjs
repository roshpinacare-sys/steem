/* ═══════════ §T-70 · THE THIRD-WATER RUNNER — Hive-Engine, measured ═══════════
 * The operator's mandate widened again: "wide hands holding the whole crypto
 * market". The machine cannot HOLD what it cannot SEE — so this runner
 * measures the third water the machine can reach WITHOUT any credential:
 * the Hive-Engine token markets (read-only public RPC, allowlist-leashed).
 *
 * MEASURED-FIRST FACTS the laws rest on (evidence/t70 probes v1..v3):
 *   · market.metrics is a STALE SNAPSHOT — its volume AND spread lie; the
 *     truth lives in the tradesHistory table (buyer+seller+type live) and
 *     the buyBook/sellBook tables (the real touch);
 *   · measured top ponds (probe3, 2026-10-04): SWAP.LTC $672/day × 942bps,
 *     DEC $616/day × 496.6bps, SWAP.BTC $121/day × 953.6bps, BEE $107/day,
 *     SWAP.HBD $56/day — absolute ceilings dwarfing the two internal waters;
 *   · NO fee surface (the T-68 law holds: income = spread).
 *
 * Leash: the trades+books fetch is the heaviest read this sensor makes →
 * at most once per 30 min, riding state's prev (the T-69 hive leash
 * pattern); every other cycle the measured ponds ride verbatim, labeled
 * with their own `at`. Fail-open per pair: a pair that errors is a typed
 * error row, never a crash and never an invented number. */

import * as fs from "node:fs";
import * as path from "node:path";
import { enginePondLaw, engineTouchSpreadLaw } from "./lib.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const FILE = path.join(STATE, "enginepond.json");

/** the ONLY endpoint this sensor may speak to (anti-phishing leash, the
 * hive.mjs law shape — official H-E API node, https only) */
export const ENGINE_ENDPOINTS_ALLOWLIST = ["https://api.hive-engine.com"];

/** the measured top ponds (probe3 ranking by absolute USD ceiling — a
 * measured seed list, not a guess; re-measured every leash window) */
export const ENGINE_PAIRS = ["SWAP.LTC", "DEC", "SWAP.BTC", "BEE", "SWAP.HBD"];

/** the trades+books leash (T-69 pattern) — at most one full pass per 30 min */
export const ENGINE_POND_FETCH_MIN_MS = 30 * 60 * 1000;

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); }; /* §T-67 ATOMIC-WRITE */

export function engineEndpointLaw(url) {
  if (typeof url !== "string") return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "https:") return null;
  return ENGINE_ENDPOINTS_ALLOWLIST.includes(`${u.protocol}//${u.host}`) ? `${u.protocol}//${u.host}` : null;
}

export function enginePondFetchDue(prevAt, nowMs = Date.now()) {
  const at = typeof prevAt === "string" ? Date.parse(prevAt.endsWith("Z") ? prevAt : `${prevAt}Z`) : null;
  if (at == null || !Number.isFinite(at)) return true;
  return nowMs - at >= ENGINE_POND_FETCH_MIN_MS;
}

let heId = 1;
async function heRpc(method, params, timeoutMs = 15_000) {
  const base = ENGINE_ENDPOINTS_ALLOWLIST[0];
  if (!engineEndpointLaw(base)) throw new Error("endpoint-blocked-by-leash");
  const r = await fetch(`${base}/rpc/contracts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: heId++, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const j = await r.json();
  if (j?.error) throw new Error(String(j.error?.message ?? JSON.stringify(j.error)).slice(0, 120));
  return j.result;
}

/** one sensor pass: per measured pair — pond (tradesHistory) + touch
 * (books). Fail-open per pair. Returns the state shape for the cockpit's
 * dominion face (the pond is consumed by dominion.mjs → pondCeilingLaw). */
export async function runEnginePond({ now = new Date().toISOString(), prev = null, ourAccount = null } = {}) {
  const out = { at: now, ok: false, endpoint: ENGINE_ENDPOINTS_ALLOWLIST[0], pairs: ENGINE_PAIRS, ponds: [], note: null };
  const nowMs = Date.parse(now) || Date.now();
  /* the leash: not due → the previous measured ponds ride verbatim (a stale
   * pond is still a measured pond — labeled with its own at, never re-invented) */
  if (!enginePondFetchDue(prev?.at, nowMs)) {
    out.ponds = Array.isArray(prev?.ponds) ? prev.ponds : [];
    out.ok = !!prev?.ok;
    out.note = "throttled-rides-prev";
    return out;
  }
  for (const sym of ENGINE_PAIRS) {
    try {
      const [trades, buys, sells] = await Promise.all([
        heRpc("find", { contract: "market", table: "tradesHistory", query: { symbol: sym }, limit: 1000, offset: 0 }),
        heRpc("find", { contract: "market", table: "buyBook", query: { symbol: sym }, limit: 30, offset: 0 }),
        heRpc("find", { contract: "market", table: "sellBook", query: { symbol: sym }, limit: 30, offset: 0 }),
      ]);
      out.ponds.push({
        symbol: sym,
        pond: enginePondLaw(Array.isArray(trades) ? trades : [], { nowMs, ourAccount }),
        touch: engineTouchSpreadLaw(buys, sells),
      });
    } catch (e) {
      out.ponds.push({ symbol: sym, pond: null, touch: null, error: String(e?.message ?? e).slice(0, 100) });
    }
  }
  out.ok = out.ponds.some((p) => p?.pond != null);
  if (!out.ok && !out.note) out.note = "enginepond-empty";
  return out;
}

/** persist + read (the T-69 hive pattern: the cycle runner reads its own
 * prev for the leash, probes, persists atomically — daily.mjs calls THIS).
 * dominion.mjs consumes state/enginepond.json each cycle — zero extra
 * chain calls. NAMED runEnginePondCycle — the probe above is runEnginePond
 * (a duplicate declaration silently shadowed it and recursed — caught live
 * in the first cycle, journaled as a failedStep). */
export async function runEnginePondCycle(now = new Date().toISOString(), ourAccount = null) {
  const prev = readJson(FILE, null);
  const out = await runEnginePond({ now, prev, ourAccount });
  writeJson(FILE, { ...out, prevAt: prev?.at ?? null });
  return out;
}

export function enginePondState() { return readJson(FILE, null); }
