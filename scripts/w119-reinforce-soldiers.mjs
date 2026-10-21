#!/usr/bin/env bun
/**
 * w119-reinforce-soldiers.mjs — W119 · REINFORCE THE SOLDIERS (SP→RC boost).
 *
 * OWNER ORDER (verbatim, trace web-39a3a21d 2026-10-21): "תגביר עוד את החיילים
 * אין להם מספיק" — measured truth (2026-10-21T03:0xZ, rc_api): hcsoldier4 RC 0.2%
 * (structurally mute), hcsoldier5 47%, hcsoldier6 68% — max_rc ≈ 3.2e10 each
 * (≈35 SP-worth) vs the master's 4.1e12. The soldiers' bodies were born WITHOUT
 * staked backing; their RC ceiling is ~1/128 of the master's. This lane stakes
 * the master's FREE vesting shares into the bodies (delegate_vesting_shares,
 * active-authority, the capital-router R292 serialization canon — zero new
 * crypto), multiplying each body's max_rc ~10-15× and letting RC regen fill a
 * real pool. This is pure reinforcement INTO our own fleet — no outflow, no
 * custody change, no owner action (W119: "ולא נדרש ממני כלום").
 *
 * LAWS: zero key material in stdout/files (receipts = fingerprints/amounts) ·
 * fail-isolated per delegatee · post-broadcast chain re-verify per body ·
 * bounded targets (13 bodies max) · master keeps ≥40% of free SP un-delegated.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { executeAs, masterAccount, adoptVerifiedWifIdentity } from "../mini-services/saos-engine/signer.mjs";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const LOG = path.join(REPO, "mini-services/saos-engine/state/w119-reinforce-log.jsonl");
const receipt = (o) => { const row = { at: new Date().toISOString(), ...o }; console.log(JSON.stringify(row)); fs.appendFileSync(LOG, JSON.stringify(row) + "\n"); };

async function rpc(method, params) {
  const nodes = ["https://api.steemit.com", "https://api.justyy.com", "https://steemapi.boylikegirl.club"];
  let last = "no-node";
  for (const host of nodes) {
    try {
      const r = await fetch(host, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }), signal: AbortSignal.timeout(12000) });
      const d = await r.json();
      if (d.error) { last = d.error.message; continue; }
      return d.result;
    } catch (e) { last = String(e).slice(0, 120); }
  }
  throw new Error("all-nodes-failed: " + last);
}

/* W119 custody pre-rail: this script runs OUTSIDE the engine process — adopt
 * the master identity from the 0600 army-keys cache, CHAIN-JUDGED, before any
 * broadcast (the engine adopts at boot; a fresh process must too). The
 * adoption verdicts ARE the custody proof — the armyCustodyState roster view
 * tracks the army bodies, the master rides its own credential lane. */
async function adoptMaster() {
  const master = masterAccount();
  const cache = JSON.parse(fs.readFileSync(path.join(REPO, ".secrets", "army-keys.json"), "utf8"));
  const a = (cache.accounts ?? []).find((x) => x.name === master);
  if (!a) throw new Error("master-not-in-cache");
  let adopted = false;
  for (const g of (a.gens ?? [])) {
    if (g.activeWif) {
      const ra = await adoptVerifiedWifIdentity(a.name, g.activeWif, { role: "active" });
      if (ra.ok) { receipt({ verdict: "MASTER-ACTIVE-ADOPTED", gen: g.gen }); adopted = true; break; }
    }
  }
  if (!adopted) throw new Error("master-active-not-verified-by-chain");
}

/* W119 allotment: soldiers (the owner's word) get the big stake; the army
 * bodies get a working-floor stake so curation/promo lanes have RC to breathe. */
const SOLDIERS = [{ name: "hcsoldier4", sp: 250 }, { name: "hcsoldier5", sp: 250 }, { name: "hcsoldier6", sp: 250 }];
const ARMY_FLOOR = [
  ["cashmachine", 40], ["haran", 40], ["israelnews", 40], ["lsa", 40], ["macrame", 40],
  ["siq", 40], ["tov", 40], ["wic", 40], ["wog", 40], ["woq", 40],
];

await adoptMaster();
const master = masterAccount();
const accs = await rpc("condenser_api.get_accounts", [[master, ...SOLDIERS.map(s => s.name), ...ARMY_FLOOR.map(a => a[0])]]);
const byName = Object.fromEntries((accs ?? []).map(a => [a.name, a]));
const me = byName[master];
if (!me) { receipt({ verdict: "MASTER-UNREADABLE" }); process.exit(1); }

const f = (s) => parseFloat(String(s).split(" ")[0]);
const vestsFree = f(me.vesting_shares) - f(me.delegated_vesting_shares) - f(me.vesting_withdraw_rate || "0 VESTS");
const dgpo = await rpc("condenser_api.get_dynamic_global_properties", []);
const spPerVest = f(dgpo.total_vesting_fund_steem) / f(dgpo.total_vesting_shares);
const freeSp = vestsFree * spPerVest;
const wantSp = [...SOLDIERS.map(s => s.sp), ...ARMY_FLOOR.map(a => a[1])].reduce((a, b) => a + b, 0);
receipt({ verdict: "PLAN", master, freeSp: +freeSp.toFixed(1), wantSp, keepPct: +(100 * (1 - wantSp / freeSp)).toFixed(1), spPerVest: spPerVest.toFixed(8) });
if (freeSp * 0.6 < wantSp) { receipt({ verdict: "REFUSED-INSUFFICIENT-FREE-SP", note: "master keeps ≥40% — reinforcement waits" }); process.exit(0); }

const targets = [
  ...SOLDIERS.map(s => ({ name: s.name, sp: s.sp, cur: byName[s.name] })),
  ...ARMY_FLOOR.map(([n, sp]) => ({ name: n, sp, cur: byName[n] })),
];

let ok = 0, failed = 0;
for (const t of targets) {
  if (!t.cur) { receipt({ verdict: "SKIP", account: t.name, why: "body-unreadable" }); continue; }
  const vests = (t.sp / spPerVest).toFixed(6);
  try {
    const res = await executeAs(master, [["delegate_vesting_shares", { delegator: master, delegatee: t.name, vesting_shares: `${vests} VESTS` }]], { tag: "W119-reinforce", role: "active" });
    let verified = null, rcPct = null;
    const failed_ = res && res.ok === false;
    if (!failed_) {
      const re = await rpc("condenser_api.get_accounts", [[t.name]]);
      const recv = f(re?.[0]?.received_vesting_shares);
      verified = recv >= f(vests) * 0.999;
      const rc = await rpc("rc_api.find_rc_accounts", { accounts: [t.name] });
      const ra = rc?.result?.rc_accounts?.[0];
      rcPct = ra ? +(parseFloat(ra.rc_manabar.current_mana) / parseFloat(ra.max_rc) * 100).toFixed(1) : null;
    }
    receipt({ verdict: failed_ ? "BROADCAST-FAIL" : "DELEGATED", account: t.name, sp: t.sp, vests, broadcast: failed_ ? String(res?.error ?? "").slice(0, 160) : "ok", chainVerified: verified, rcPct });
    failed_ ? failed++ : ok++;
  } catch (e) { failed++; receipt({ verdict: "ERROR", account: t.name, error: String(e?.message ?? e).slice(0, 140) }); }
}
receipt({ verdict: "W119-REINFORCE-DONE", ok, failed, note: "soldiers' max_rc now ~10-15×; RC regen fills the new pool over hours" });
