/* ─────────────────────────────────────────────────────────────────────────
 * G78-c · CURATION YIELD STREAMING — the treasury-form export rail.
 *
 * Routes the fleet's REAL claimable curation yield into the fleet-economy
 * treasury consumer format (measured from fleet-economy/lib/profit-proof.ts
 * + scripts/profit-proof-export.mjs):
 *
 *   TREASURY ROWS (state/curation-yield-intake.jsonl — the stable consumer
 *   form, byte-identical shape to buildYieldRows output):
 *     { at, stream, amount, currency, "proof-ref", source }
 *     one row per currency; an empty stream emits ONE honest zero row
 *     ("stream-empty") — never an invented number.
 *
 *   DETAIL ROWS (receipts/curation-yield.jsonl — SAOS-EXTERNAL-PROFIT/1
 *   compatible, sumCuration-law fields):
 *     { kind:"curation", opNature:"real-tx", account, vests, steem, sbd,
 *       usd, ts, proof }
 *
 * ZERO FABRICATION: every number is read live from condenser_api.get_accounts
 * reward balances of a VAULT-VALID body (army-curation's roster law). There is
 * no price oracle here → usd is the honest 0. Wounded bodies (CUSTODY-WOUNDS)
 * are skipped, recorded, never counted.
 *
 * TELEMETRY: the same run exposes per-soldier VP-eff and RC% to
 * state/soldier-telemetry.json (mission law: per-soldier RC/VP in state).
 * ───────────────────────────────────────────────────────────────────────── */

import * as fs from "node:fs";
import * as path from "node:path";
import { rpcCall } from "./measure.mjs";
import { effectiveVests, vpEffPct } from "./curator.mjs";
import { rcAvailable } from "./rc-pool.mjs";
import { VAULT_VALID_ROSTER, readCustodyWounds, woundFilter } from "./army-curation.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const RECEIPTS = path.join(DIR, "receipts", "curation-yield.jsonl");
const INTAKE = path.join(STATE, "curation-yield-intake.jsonl");
const TELEMETRY = path.join(STATE, "soldier-telemetry.json");
const INTAKE_MAX_LINES = 4000; /* disk law: the consumer stream rolls, never grows unbounded */

export const YIELD_STREAM = "steem:curation";
export const YIELD_SOURCE = "steem:saos-engine/curation-yield";

const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };

/* "123.456 SBD" → {amount, currency}; anything else → null (never guessed) */
export function parseAsset(v) {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(-?\d+(?:\.\d+)?)\s+([A-Z]+)$/);
  return m ? { amount: Number(m[1]), currency: m[2] } : null;
}

const r6 = (x) => Math.round(Number(x) * 1e6) / 1e6;

/* pure: build treasury-form + detail rows from RAW get_accounts bodies.
 * Shape-mismatched bodies are NOT counted and NOT invented — the totals only
 * ever sum real reward-balance numbers. */
export function yieldRowsFromAccounts(accounts, { at, stream = YIELD_STREAM, source = YIELD_SOURCE, proofRef = "condenser_api.get_accounts" } = {}) {
  const detail = [];
  const totals = { STEEM: 0, SBD: 0, VESTS: 0 };
  let counted = 0;
  for (const a of Array.isArray(accounts) ? accounts : []) {
    if (!a?.name) continue;
    const sbd = parseAsset(a.reward_sbd_balance);
    const steem = parseAsset(a.reward_steem_balance);
    const vests = parseAsset(a.reward_vesting_steem);
    if (!sbd || !steem || !vests) continue; // malformed body: fail-honest (absent, not faked)
    counted += 1;
    totals.SBD += sbd.amount; totals.STEEM += steem.amount; totals.VESTS += vests.amount;
    detail.push({ kind: "curation", opNature: "real-tx", account: a.name, vests: r6(vests.amount), steem: r6(steem.amount), sbd: r6(sbd.amount), usd: 0, ts: at, proof: `${proofRef}#${a.name}` });
  }
  const rows = Object.entries(totals).filter(([, v]) => v > 0).map(([currency, v]) => ({ at, stream, amount: r6(v), currency, "proof-ref": `${proofRef}#${counted}-bodies`, source }));
  const intake = rows.length > 0 ? rows
    : [{ at, stream, amount: 0, currency: "n/a", "proof-ref": `stream-empty:${counted}-bodies-all-zero@${proofRef}`, source }]; /* fleet-economy law: empty/all-zero stream = ONE honest zero row, never an invented number */
  return { detail, intake, counted, totals: { STEEM: r6(totals.STEEM), SBD: r6(totals.SBD), VESTS: r6(totals.VESTS) } };
}

/* pure: per-soldier VP-eff / RC% telemetry from the same chain reads */
export function soldierTelemetry(accounts, rcAccounts, { at } = {}) {
  const rcBy = {};
  for (const rc of Array.isArray(rcAccounts) ? rcAccounts : []) {
    if (!rc?.account) continue;
    const a = rcAvailable(rc);
    rcBy[rc.account] = a.max > 0 ? Math.round((a.available / a.max) * 10000) / 100 : null; /* regen-adjusted RC% (R262 measured semantics) */
  }
  const per = {};
  for (const a of Array.isArray(accounts) ? accounts : []) {
    if (!a?.name) continue;
    const vests = effectiveVests(a);
    per[a.name] = {
      vpEffPct: Math.round(vpEffPct(Number(a.voting_manabar?.current_mana ?? 0), vests) * 100) / 100,
      rcPct: rcBy[a.name] ?? null,
      rewardSteem: parseAsset(a.reward_steem_balance)?.amount ?? null,
      rewardSbd: parseAsset(a.reward_sbd_balance)?.amount ?? null,
      rewardVests: parseAsset(a.reward_vesting_steem)?.amount ?? null,
    };
  }
  return { at, per };
}

/* the intake stream rolls: append new rows, keep the tail within the cap */
function appendIntake(rows) {
  fs.mkdirSync(STATE, { recursive: true });
  let prev = [];
  try { prev = fs.readFileSync(INTAKE, "utf8").split("\n").filter(Boolean); } catch { /* first write */ }
  const merged = [...prev, ...rows.map((r) => JSON.stringify(r))].slice(-INTAKE_MAX_LINES);
  const t = `${INTAKE}.tmp.${process.pid}`;
  fs.writeFileSync(t, merged.join("\n") + "\n");
  fs.renameSync(t, INTAKE);
}

/* ── the run: measure → build → journal (reads only; the stream never signs) ── */
export async function runCurationYield({ now = new Date().toISOString() } = {}) {
  const base = { at: now, rail: "curation-yield", stream: YIELD_STREAM, source: YIELD_SOURCE };
  const { allowed, wounded } = woundFilter(VAULT_VALID_ROSTER, readCustodyWounds());
  if (!allowed.length) {
    const out = { ...base, verdict: "NO-ALLOWED-BODIES", woundedCount: wounded.length };
    appendLine(RECEIPTS, out);
    return out;
  }
  const r = await rpcCall("condenser_api.get_accounts", [allowed]);
  if (!r.ok || !Array.isArray(r.result)) {
    const out = { ...base, verdict: "CHAIN-READ-FAILED", error: r.error ?? "read failed" };
    appendLine(RECEIPTS, out);
    return out;
  }
  const built = yieldRowsFromAccounts(r.result, { at: now });

  /* per-soldier RC/VP telemetry — fail-isolated, never blocks the yield stream */
  let telemetry = null, telemetryVerdict = "SKIPPED";
  try {
    let rc = await rpcCall("rc_api.find_rc_accounts", { accounts: allowed });
    let rcRows = rc?.ok ? rc.result?.rc_accounts ?? [] : [];
    if (!rcRows.length) {
      /* the primary node serves ok-but-empty when the rc_api plugin is off —
       * fall back to api.steemit.com (measured: rc_api present there) */
      const res = await fetch("https://api.steemit.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "rc_api.find_rc_accounts", params: { accounts: allowed }, id: 1 }), signal: AbortSignal.timeout(15000) });
      const j = await res.json().catch(() => null);
      rcRows = j?.result?.rc_accounts ?? [];
    }
    telemetry = soldierTelemetry(r.result, rcRows, { at: now });
    telemetryVerdict = rcRows.length ? "MEASURED" : "RC-UNAVAILABLE";
    const t = `${TELEMETRY}.tmp.${process.pid}`;
    fs.writeFileSync(t, JSON.stringify(telemetry, null, 2));
    fs.renameSync(t, TELEMETRY);
  } catch (e) {
    telemetryVerdict = `FAILED:${String(e?.message ?? e).slice(0, 80)}`;
  }

  const out = { ...base, verdict: "STREAMED", counted: built.counted, totals: built.totals, woundedSkipped: wounded, intakeRows: built.intake.length, detailRows: built.detail.length, telemetryVerdict };
  appendLine(RECEIPTS, out);
  for (const d of built.detail) appendLine(RECEIPTS, d);
  appendIntake(built.intake);
  return out;
}

/* consumer-side tail read (what fleet-economy's intake would see) */
export function curationYieldIntakeTail(n = 50) {
  try { return fs.readFileSync(INTAKE, "utf8").split("\n").filter(Boolean).slice(-n); } catch { return []; }
}
