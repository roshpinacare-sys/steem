/**
 * fills.mjs — T-25 · THE FILL-CAPTURE LEDGER (T-19d · נתח-המילויים המדוד).
 * History: the observe step counted our chain fills (13 live today) and threw
 * the array away — so the market-making rail could never leave "blocked" (no
 * window, no denominator, no share). This instrument fixes the ROOT: the fills
 * from the SAME measureAll read (zero extra chain reads) are merged into a
 * persistent ledger (dedupe by trx id, recompute-from-raw law — never store
 * derived numbers as truth), and fillWindow turns the ledger into the honest
 * measured basis: 24h volume, venue share, captured edge vs parity, realized
 * P&L over the ACTUAL covered window. Read-only on the chain — runs with or
 * without a credential.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fillWindow } from "./lib.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const LEDGER = path.join(STATE, "fills-ledger.json");
const ROLLUP = path.join(STATE, "fills.json");
const CAP = 2000; // ~150 days at today's 13 fills/day — the ledger never balloons

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
};

const LEDGER_DEFAULT = path.join(STATE, "fills-ledger.json");

export function fillsState() { return readJson(ROLLUP, null); }
export function fillLedgerState(file = LEDGER_DEFAULT) { return readJson(file, null); }

/** merge new chain-truth fills into the persistent ledger (dedupe by seq+at,
 * atomic write, capped). Returns the merged ledger (raw fills ONLY — no
 * derived fields; every rollup recomputes from raw, the T-18 lesson).
 * W12-D · the ESTATE ONE-BODY law: a fill_order trx appears in BOTH parties'
 * histories — the ledger is global and dedupes by trx seq so an inter-estate
 * trade is never double-counted; rows may carry an `account` tag (row-level
 * wins over the opts default) for attribution, never for identity. */
export function mergeFillLedger(newFills = [], { now = new Date().toISOString(), account = null, file = LEDGER } = {}) {
  const prev = readJson(file, { fills: [] });
  const prevFills = Array.isArray(prev?.fills) ? prev.fills : [];
  const seen = new Set(prevFills.map((f) => `${f.seq}|${f.at}`));
  const fresh = [];
  for (const f of Array.isArray(newFills) ? newFills : []) {
    if (!f || f.seq == null || !f.at) continue;
    const key = `${f.seq}|${f.at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = { seq: f.seq, at: Number(f.at), side: f.side, steem: Number(f.steem), sbd: Number(f.sbd) };
    if (f.account != null || account != null) row.account = f.account ?? account;
    fresh.push(row);
  }
  const merged = [...fresh, ...prevFills]
    .sort((a, b) => b.at - a.at)
    .slice(0, CAP);
  writeJson(file, { fills: merged, at: now, added: fresh.length });
  return { ledger: { fills: merged, at: now }, added: fresh.length };
}

/** the measured rollup → state/fills.json (economics + cockpit + /fills) */
export function runFills({ fills = null, now = new Date().toISOString(), venueVolSteem24h = null, marketFillsPerDay = null, parity = null, sbdUsd = null } = {}) {
  const rows = Array.isArray(fills) ? fills : (fillLedgerState()?.fills ?? []);
  const out = {
    day: now.slice(0, 10),
    at: now,
    ...fillWindow({ fills: rows, nowMs: Date.parse(now) || 0, venueVolSteem24h, marketFillsPerDay, parity, sbdUsd }),
    source: "fills-ledger.json — chain fill_order truth, merged + deduped, realized recomputed from raw",
  };
  writeJson(ROLLUP, out);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const m = mergeFillLedger([]);
  console.log(JSON.stringify(runFills({ fills: m.ledger.fills }), null, 2));
}
