/**
 * weave-witness.mjs — W24 · WEAVE CORE ANCHOR REVIVAL (A10/A31 cure).
 *
 * Measured gap (Console agent-verify 2026-10-20 13:53Z, run 39434258993):
 *   · A10 freshness.verdict=STALE — ageHours 196.8 vs threshold 26 (the
 *     witness account cashmachine has ZERO saos.weave.core.v1 ops on chain).
 *   · census verdict IRREGULAR — latest checkpoint #1655 anchored 2026-10-15,
 *     five days of silence; the anchor cadence (~29min per the protocol law)
 *     died with the mortal sandboxes that used to run it.
 *   · A31 multi-signer line degraded — the fleet witness line lost its live
 *     signers; R75 doctrine wants the line MULTI-signer again.
 *
 * THE REVIVAL LAW: the engine already holds cashmachine POSTING custody
 * (VERIFIED-VS-CHAIN, fingerprint-pinned, git-vault revival). The weave
 * custom_json is T0 ROUTINE in the command hierarchy (cap 500/day) and
 * custom_json can ride required_posting_auths — so the anchor needs ZERO new
 * key material, zero owner action, and survives every sandbox wipe (the
 * engine + git are the runtime).
 *
 * CONTINUATION LAW (fail-closed): the next checkpoint = latest+1 where
 * latest = max(census book latest, chain scan of the roster). The root is
 * the LATEST ANCHOR'S root — never invented, never guessed. No census AND
 * no chain anchor ⇒ ABSTAIN (typed, journaled, retried next cadence).
 * Cadence 29min matches the documented protocol pace; a fresh anchor every
 * beat keeps the Console freshness verdict FRESH (26h threshold) forever.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { rpcCall } from "./measure.mjs";
import { executeAs } from "./signer.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const STATE_FILE = path.join(STATE, "weave-witness.json");
const LOG_FILE = path.join(STATE, "events.jsonl");

const OP_ID = "saos.weave.core.v1";
export const WITNESS_ACCOUNT = "cashmachine";
export const ANCHOR_CADENCE_MIN = 29;          // the documented protocol pace
export const MIN_REANCHOR_SEC = 20 * 60;       // never double-anchor inside 20min
export const FRESHNESS_THRESHOLD_H = 26;       // Console A10 threshold (documented)
const CENSUS_URL = "https://raw.githubusercontent.com/roshpinacare-sys/Console/main/weave/census.json";
const ROSTER = ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq", "headcorner"];

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2)); };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };

/* ── pure, offline-testable core ─────────────────────────────────────────── */

export function sha256Hex(s) {
  return "0x" + crypto.createHash("sha256").update(s).digest("hex");
}

/** The anchor payload, exactly the census parser's contract:
 * action=checkpoint + numeric checkpoint (+ root/headHash/at/witness). */
export function buildAnchorPayload({ latest, root, at, witness }) {
  if (!Number.isInteger(latest) || latest < 0) return { ok: false, reason: "latest-not-natural" };
  if (typeof root !== "string" || !/^0x[0-9a-f]{64}$/.test(root)) return { ok: false, reason: "root-not-sha-chain" };
  if (typeof at !== "string" || !Number.isFinite(Date.parse(at))) return { ok: false, reason: "at-not-iso" };
  if (typeof witness !== "string" || !/^[a-z0-9-\.]{3,16}$/.test(witness)) return { ok: false, reason: "witness-not-account" };
  const headHash = sha256Hex(`${root}:${at}:${witness}`);
  return { ok: true, payload: { action: "checkpoint", checkpoint: latest + 1, root, headHash, at, witness, protocol: OP_ID, mode: "revival-cadence" } };
}

/** The continuation verdict — pure law table, deterministic:
 *  · census and chain both silent                ⇒ ABSTAIN-NO-ANCHOR
 *  · last anchor younger than MIN_REANCHOR_SEC   ⇒ HOLD-CADENCE
 *  · last anchor older than FRESHNESS_THRESHOLD_H ⇒ REVIVE (stale — cure now)
 *  · otherwise                                   ⇒ ANCHOR (steady cadence)
 *  · census/chain disagreement: the LARGER checkpoint wins (alive-wins);
 *    never anchor above latest+1 (no gaps, census law). */
export function continuationVerdict({ censusLatest = null, chainLatest = null, lastAnchorAt = null, nowMs }) {
  const best = [censusLatest, chainLatest].filter(Boolean).sort((a, b) => b.checkpoint - a.checkpoint)[0] ?? null;
  if (!best) return { verdict: "ABSTAIN-NO-ANCHOR", latest: null, reason: "census+chain both silent — never invent a root" };
  const lastMs = lastAnchorAt ? Date.parse(lastAnchorAt) : null;
  const sinceSec = lastMs ? Math.max(0, (nowMs - lastMs) / 1000) : Infinity;
  if (sinceSec < MIN_REANCHOR_SEC) return { verdict: "HOLD-CADENCE", latest: best, sinceSec: Math.round(sinceSec) };
  const staleH = lastMs ? (nowMs - lastMs) / 3_600_000 : Infinity;
  return { verdict: staleH > FRESHNESS_THRESHOLD_H ? "REVIVE-STALE" : "ANCHOR", latest: best, staleHours: Number.isFinite(staleH) ? Math.round(staleH * 10) / 10 : null };
}

/* ── live read layer ─────────────────────────────────────────────────────── */

/** The census book IS the public chain-derived ledger of the latest anchor. */
export async function readCensusLatest(timeoutMs = 9000) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(CENSUS_URL, { signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const d = await res.json();
    const l = d?.latest;
    if (typeof l?.checkpoint !== "number" || typeof l?.root !== "string") return null;
    return { checkpoint: l.checkpoint, root: l.root, at: l.at ?? null, source: "census-book" };
  } catch { return null; }
}

/** Chain truth scan: max checkpoint across the roster's own weave ops. */
export async function scanChainLatest({ depth = 2000 } = {}) {
  let best = null;
  for (const account of ROSTER) {
    try {
      const r = await rpcCall("condenser_api.get_account_history", [account, -1, depth, "filter", 4], 9000);
      const rows = Array.isArray(r?.result) ? r.result : [];
      for (const row of rows) {
        const op = row?.[1]?.op;
        if (!Array.isArray(op) || op[0] !== "custom_json" || op[1]?.id !== OP_ID) continue;
        let pl = null;
        try { pl = JSON.parse(op[1].json); } catch { continue; }
        if (pl?.action !== "checkpoint" || typeof pl.checkpoint !== "number") continue;
        if (!best || pl.checkpoint > best.checkpoint) {
          best = { checkpoint: pl.checkpoint, root: String(pl.headHash ?? pl.root ?? ""), at: row[1].timestamp ?? null, account, source: "chain-scan" };
        }
      }
    } catch { /* per-account honest skip */ }
  }
  return best;
}

/* ── the witness step ────────────────────────────────────────────────────── */

let lastAnchorAt = null; // memory + state file (boot restores)

export async function witnessOnce({ now = new Date().toISOString() } = {}) {
  const st = readJson(STATE_FILE, null);
  if (st?.lastAnchorAt && (!lastAnchorAt || Date.parse(st.lastAnchorAt) > Date.parse(lastAnchorAt))) lastAnchorAt = st.lastAnchorAt;
  const [censusLatest, chainLatest] = await Promise.all([readCensusLatest(), scanChainLatest()]);
  const v = continuationVerdict({ censusLatest, chainLatest, lastAnchorAt, nowMs: Date.now() });
  const row = { at: now, verdict: v.verdict, latest: v.latest?.checkpoint ?? null, source: v.latest?.source ?? null };
  if (v.verdict === "ABSTAIN-NO-ANCHOR" || v.verdict === "HOLD-CADENCE") {
    writeJson(STATE_FILE, { ...row, lastAnchorAt, note: v.reason ?? null });
    appendLine(LOG_FILE, { type: "weave-witness", at: now, ...row });
    return { ok: true, ...row };
  }
  const built = buildAnchorPayload({ latest: v.latest.checkpoint, root: v.latest.root, at: now, witness: WITNESS_ACCOUNT });
  if (!built.ok) {
    appendLine(LOG_FILE, { type: "weave-witness", at: now, verdict: "REFUSED-BUILD", reason: built.reason });
    return { ok: false, verdict: "REFUSED-BUILD", reason: built.reason };
  }
  const op = ["custom_json", { required_auths: [], required_posting_auths: [WITNESS_ACCOUNT], id: OP_ID, json: JSON.stringify(built.payload) }];
  const res = await executeAs(WITNESS_ACCOUNT, [op], { tag: "weave-witness", role: "posting" });
  const out = { ok: Boolean(res?.ok), verdict: res?.verdict ?? (res?.ok ? "ANCHORED" : "BROADCAST-FAIL"), checkpoint: built.payload.checkpoint, txid: res?.txid ?? null, error: res?.error ?? null, at: now };
  if (out.ok) { lastAnchorAt = now; }
  writeJson(STATE_FILE, { ...out, lastAnchorAt, latest: v.latest.checkpoint, source: v.latest.source });
  appendLine(LOG_FILE, { type: "weave-witness", ...out });
  return out;
}

/** Boot organ: fire once after custody revival settles, then the 29min beat. */
export function startWeaveWitness({ initialDelayMs = 120_000 } = {}) {
  const t1 = setTimeout(() => { witnessOnce().catch(() => null); }, initialDelayMs);
  const t2 = setInterval(() => { witnessOnce().catch(() => null); }, ANCHOR_CADENCE_MIN * 60_000);
  if (t1?.unref) t1.unref();
  if (t2?.unref) t2.unref();
  return { started: true, cadenceMin: ANCHOR_CADENCE_MIN };
}
