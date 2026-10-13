/**
 * rc-pool.mjs — R262 · THE RC MUTUAL-AID POOL (עזרה הדדית לפי יכולת).
 *
 * Operator order 2026-10-08 (verbatim intent): "צריך להחזיר להפעיל את כולם
 * על Hive". The measured wall (live rc_api, R262): FIVE of the nine accounts
 * have max_rc BELOW the measured 2.3B post cost (cashmachine 2.105B, woq
 * 2.273B, israelnews 2.227B, haran 2.265B, siq 2.29B) — no amount of waiting
 * ever lifts them over the line. Four accounts (lsa 3.891B, macrame 4.178B,
 * wic 3.086B, wog 3.273B) hold real RC headroom.
 *
 * THE MECHANISM: Hive's RC delegation (custom_json id "rc" carrying
 * ["delegate_rc", {...}]) moves RC between accounts WE ALREADY CUSTODY.
 * This is mutual aid inside our own community only — no external services,
 * no key exchange, nothing leaves the family. Donors keep their own posting
 * line (DONOR_KEEP_MAX); recipients get lifted to LIFT_TARGET so a post fits
 * with margin. Every delegation is verified AFTER the broadcast by
 * re-measuring both sides — the chain is the judge, the state keeps the
 * receipts, and the empirical deltas (does current_mana move with max?) are
 * recorded in state/rc-pool.json for the next pass to plan smarter.
 *
 * THE LAWS:
 *  · custody first (hiveCustody) — memory-only WIFs, verdicts only in state.
 *  · caps: ≤MAX_LIFTS_PER_PASS delegations, each ≤MAX_LIFT_RC.
 *  · a paused account (downvote veto) neither gives nor receives.
 *  · planLifts is PURE (selftest-vectorable): smallest deficit first,
 *    donors strongest-first, a donor never crosses its own floor.
 *  · idempotent: an account at/over target is skipped, so the pool converges
 *    and re-balances each pass as RC regenerates.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { rpcHive, HIVE_ROSTER, POST_RC_COST, hiveCustody, sendAs } from "./hive.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const FILE = path.join(STATE, "rc-pool.json");
const FLAG_PAUSES_FILE = path.join(STATE, "flag-pauses.json");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJsonSafe = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2)); fs.renameSync(t, p); };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)) + "\n"); };

/* planning constants (RC units) — MEASURED, node-judged (R262, 2026-10-08):
 *  · the post line: a full post costs ~2.3B RC (hive.mjs measurement).
 *  · MIN_DELEGATION_RC: the node REJECTED our 0.41-0.47B lifts live with
 *    "Cannot delegate less than 1607605799 rc" — Hive's RC-delegation floor.
 *  · THE DELEGATION DRAWS FROM THE DONOR'S CURRENT MANA: the node then
 *    REJECTED the minimum-sized lift with "from_delegable_rc >= delta_total:
 *    Account macrame has insufficient RC (have 496240402, needs 1607605799)"
 *    — a donor needs max above its keep AND available mana ≥ the lift RIGHT
 *    NOW. The lift stays PLANNED (intent) and the pass reports
 *    DONOR-MANA-DEFER until the manabar regenerates (~32h measured); nothing
 *    is consumed by a doomed broadcast.
 *  · account_update2 measured cost ≈ 0.145B RC (macrame cur drop across its
 *    accepted profile write) — META_RC_FLOOR 0.3B is honest. */
export const MIN_DELEGATION_RC = 1_607_605_799;
export const LIFT_TARGET = 3_700_000_000;    // one minimum delegation lands a recipient far above the 2.3B line
export const DONOR_KEEP_MAX = 2_450_000_000; // a donor keeps more than the post line for itself
export const MAX_LIFT_RC = 2_000_000_000;    // per-delegation cap (above the floor, below donor ruin)
export const MAX_LIFTS_PER_PASS = 1;         // the conserved budget affords one minimum delegation

/* ── pure: the RC measurement shape ───────────────────────────────────────── */
export function rcAvailable(rcAccount, nowSec = Math.floor(Date.now() / 1000)) {
  const cur = Number(rcAccount?.rc_manabar?.current_mana ?? 0);
  const max = Number(rcAccount?.max_rc ?? 0);
  const upd = Number(rcAccount?.rc_manabar?.last_update_time ?? 0);
  const elapsed = Math.max(0, nowSec - (Number.isFinite(upd) ? upd : 0));
  const available = max > 0 ? Math.min(max, cur + (max * Math.min(elapsed, 432_000)) / 432_000) : cur;
  return { cur, max, available };
}

/* ── pure: the delegation plan ────────────────────────────────────────────────
 * recipients: accounts whose max_rc is under LIFT_TARGET, who reach the
 *   target with one minimum lift, and who are not paused — broken accounts
 *   (under the measured POST_RC_COST post line) come first, then deficit.
 * donors: accounts with spare max above DONOR_KEEP_MAX, strongest first.
 * THE NODE-JUDGED LAW (R262): every lift is EXACTLY the measured minimum
 *   delegation (a smaller delegation is rejected by the chain, a larger one
 *   would push a donor under its own posting line). Recipients below
 *   LIFT_TARGET even AFTER a minimum lift are skipped — a partial lift is
 *   not a thing on this chain. max_rc is the binding constraint; the
 *   current-mana semantics stay measured-post-broadcast, never assumed. */
export function planLifts(states, { liftTarget = LIFT_TARGET, donorKeepMax = DONOR_KEEP_MAX, minDelegation = MIN_DELEGATION_RC, postLine = POST_RC_COST, maxLifts = MAX_LIFTS_PER_PASS, paused = {} } = {}) {
  const entries = Object.entries(states ?? {})
    .filter(([name, s]) => s && Number.isFinite(s.max) && Number.isFinite(s.cur))
    .map(([name, s]) => ({ name, max: s.max, cur: s.cur }));
  const recipients = entries
    .filter((e) => e.max < liftTarget && e.max + minDelegation >= liftTarget && !paused[e.name])
    .sort((a, b) =>
      /* broken accounts (under the post line) are lifted FIRST — comfort
       * lifts never outrank a member who cannot speak at all */
      ((a.max < postLine) !== (b.max < postLine))
        ? (a.max < postLine ? -1 : 1)
        : (liftTarget - a.max) - (liftTarget - b.max));
  const donors = entries
    .filter((e) => e.max - minDelegation >= donorKeepMax && !paused[e.name])
    .sort((a, b) => b.max - a.max);
  const lifts = [];
  for (const r of recipients) {
    if (lifts.length >= maxLifts) break;
    const donor = donors.find((d) => d.name !== r.name);
    if (!donor) continue;
    lifts.push({ from: donor.name, to: r.name, maxRc: Math.floor(minDelegation) });
  }
  return lifts;
}

/* ── pure: the delegate_rc custom_json op (Hive RC-delegation wire shape) ─── */
export function delegateRcOps(from, delegatees, maxRc) {
  const payload = { from, delegatees, max_rc: Math.floor(maxRc), required_auths: [], required_posting_auths: [from] };
  return [["custom_json", {
    required_auths: [],
    required_posting_auths: [from],
    id: "rc",
    json: JSON.stringify(["delegate_rc", payload]),
  }]];
}

/* ── the live pass ─────────────────────────────────────────────────────────── */
export async function runRcPool({ now = new Date().toISOString(), dryRun = false } = {}) {
  const t0 = Date.now();
  const custody = await hiveCustody({ now });
  const out = { at: now, custody: { verified: custody.verified, total: custody.total }, lifts: [], measured: {}, deferred: [], caps: `≤${MAX_LIFTS_PER_PASS} lifts/pass · ≤${Math.round(MAX_LIFT_RC / 1e9 * 1000) / 1000}B each · donor keeps ≥${Math.round(DONOR_KEEP_MAX / 1e9 * 1000) / 1000}B max` };
  if (custody.verified === 0) { out.verdict = "HIVE-NO-CUSTODY"; out.ms = Date.now() - t0; writeJsonSafe(FILE, out); return out; }
  const pauses = readJson(FLAG_PAUSES_FILE, { accounts: {} })?.accounts ?? {};
  const paused = Object.fromEntries(Object.entries(pauses).filter(([, v]) => v?.active === true).map(([k]) => [k, true]));

  /* measure everyone */
  const states = {};
  for (const account of HIVE_ROSTER) {
    const r = await rpcHive("rc_api.find_rc_accounts", { accounts: [account] });
    const a = r?.result?.rc_accounts?.[0];
    if (!a) { out.deferred.push({ account, reason: "rc-read-failed" }); continue; }
    const m = rcAvailable(a);
    states[account] = m;
    out.measured[account] = { maxB: +(m.max / 1e9).toFixed(3), curB: +(m.cur / 1e9).toFixed(3), availB: +(m.available / 1e9).toFixed(3), canPost: m.available >= POST_RC_COST, structural: m.max < POST_RC_COST };
  }

  const lifts = planLifts(states, { paused });
  out.planned = lifts;
  if (!lifts.length) { out.verdict = "POOL-BALANCED"; out.ms = Date.now() - t0; writeJsonSafe(FILE, out); return out; }

  for (const lift of lifts.slice(0, MAX_LIFTS_PER_PASS)) {
    if (dryRun) { out.lifts.push({ ...lift, verdict: "DRY-RUN" }); continue; }
    if (custody.results[lift.from] !== "VERIFIED-VS-HIVE-CHAIN") {
      out.lifts.push({ ...lift, verdict: "NO-CUSTODY" }); continue;
    }
    const ops = delegateRcOps(lift.from, [lift.to], lift.maxRc);
    /* the node-judged mana gate: a delegation draws from the donor's CURRENT
     * mana — a doomed broadcast consumes nothing but teaches nothing new;
     * defer with the measured shortfall until the manabar regenerates */
    const donorNow = out.measured[lift.from] ?? {};
    const donorAvailB = Number(donorNow.availB ?? 0);
    if (donorAvailB * 1e9 < lift.maxRc) {
      out.lifts.push({ ...lift, verdict: "DONOR-MANA-DEFER", shortfallRc: Math.floor(lift.maxRc - donorAvailB * 1e9) });
      appendLine(path.join(STATE, "events.jsonl"), { type: "hive.rc-pool-defer", at: now, ...lift, shortfallRc: Math.floor(lift.maxRc - donorAvailB * 1e9), reason: "donor available mana below the minimum delegation — regen will unlock it" });
      continue;
    }
    const res = await sendAs(lift.from, ops);
    const receipt = { ...lift, verdict: res.ok ? "BROADCAST" : res.verdict ?? "REJECTED", digest8: res.digest8 ?? null, error: res.error ? String(res.error).slice(0, 140) : null, node: res.node ?? null };
    out.lifts.push(receipt);
    appendLine(path.join(STATE, "events.jsonl"), { type: "hive.rc-pool", at: now, ...receipt });
    if (res.ok) {
      /* the empirical pass: re-measure BOTH sides so the next plan runs on
       * measured semantics, not assumptions (does max move? does cur move?) */
      for (const side of [lift.from, lift.to]) {
        const r = await rpcHive("rc_api.find_rc_accounts", { accounts: [side] });
        const a = r?.result?.rc_accounts?.[0];
        if (a) out.measured[side] = { ...rcAvailable(a), afterLift: true, maxB: +(Number(a.max_rc ?? 0) / 1e9).toFixed(3), curB: +(Number(a.rc_manabar?.current_mana ?? 0) / 1e9).toFixed(3), availB: +(rcAvailable(a).available / 1e9).toFixed(3) };
      }
    }
  }
  out.verdict = dryRun ? "DRY-RUN" : out.lifts.some((l) => l.verdict === "BROADCAST") ? "POOL-EXECUTED" : out.lifts.some((l) => l.verdict === "DONOR-MANA-DEFER") ? "POOL-PENDING-REGEN" : "POOL-REFUSED";
  out.ms = Date.now() - t0;
  writeJsonSafe(FILE, out);
  return out;
}

export function rcPoolState() { return readJson(FILE, null); }

if (import.meta.url === `file://${process.argv[1]}`) {
  runRcPool({ dryRun: true }).then((r) => console.log(JSON.stringify(r, (k, v) => (typeof v === "bigint" ? v.toString() : v), 2))).catch((e) => { console.error("RC-POOL-FAIL", e); process.exit(1); });
}
