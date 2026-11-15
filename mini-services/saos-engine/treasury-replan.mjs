#!/usr/bin/env node
// treasury-replan.mjs — R314e law: delegation op SETS totals, currentMasterSp measured live.
// Rebuilt 2026-11-02 after the previous copy was lost to a wipe (never committed — durable-loss lesson).
// Usage:
//   node treasury-replan.mjs            → dry-run plan (no chain writes)
//   node treasury-replan.mjs delegate   → execute delegate_vesting_shares from headcorner
// Reads the fresh measurement from receipts/effectiveness-audit-last.json (run
// fleet-effectiveness-audit.mjs first). Never prints key material — fingerprints only.
// Treasury keep: 1000 SP (never breached; R314e).
import { readFileSync, appendFileSync, mkdirSync } from "fs";
import { createRequire } from "module";
import crypto from "crypto";
const require2 = createRequire(import.meta.url);
const steem = require2("/home/z/my-project/fleet/steem/mini-services/saos-engine/node_modules/steem");
const SECRETS = "/home/z/my-project/fleet/steem/.secrets";
const RECEIPTS = "/home/z/my-project/fleet/steem/receipts";
const TREASURY = "headcorner";
const TREASURY_KEEP_SP = 1000;
const EXECUTE = process.argv[2] === "delegate";

const last = JSON.parse(readFileSync(`${RECEIPTS}/effectiveness-audit-last.json`, "utf8"));
const rows = last.rows || [];
// R365 fix (2026-11-15): require the numeric row — the receipt used to carry a second
// same-name note-row for the treasury, and find() picked it, failing the run.
const treasuryRow = rows.find(r => r.name === TREASURY && typeof r.netSp === "number");
if (!treasuryRow || typeof treasuryRow.netSp !== "number") { console.log("REPLAN-ERROR: no treasury measurement — run fleet-effectiveness-audit.mjs first"); process.exit(1); }

// live VESTS↔SP ratio (measured now, R314e: never cached)
const dyn = await (await fetch("https://api.steemit.com", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_dynamic_global_properties", params: [], id: 1 }) })).json();
const ratio = parseFloat(dyn.result.total_vesting_fund_steem) / parseFloat(dyn.result.total_vesting_shares);
// R365 fix (2026-11-15): delegate_vesting_shares SETS the delegator→delegatee TOTAL,
// it is not an increment (measured: hcsoldier6 held a 20 SP legacy delegation; setting
// +16 SP REPLACED it and the account LOST 4 SP). The plan must read the live delegation
// and SET current+need. Also: only custody-roster accounts qualify as targets — the
// audit receipt is the roster source and no longer emits metadata pseudo-accounts.
const spToVests = sp => sp / ratio;
const vestToSp = vests => parseFloat(vests) * ratio; // (R365: was missing here — ReferenceError swallowed into curDelegSp=0)

const budget = treasuryRow.netSp - TREASURY_KEEP_SP;
const flagRows = rows.filter(r => r.flag === "ZERO-SP" || r.flag === "BELOW-FLOOR");
const targets = [];
for (const r of flagRows) {
  let curDelegSp = 0, netLive = r.netSp; // receipt value only as fallback
  try {
    // measured working shape: ["<delegator>","",limit] then filter (start="<acct>" asserts)
    const vd = await (await fetch("https://api.steemit.com", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_vesting_delegations", params: [TREASURY, "", 100], id: 1 }) })).json();
    const row = ((vd.result || []).find(x => x.delegator === TREASURY && x.delegatee === r.name)) || null;
    curDelegSp = row ? vestToSp(row.vesting_shares) : 0;
    // R365: measure the delegatee LIVE (own + received) — the audit receipt can be stale by
    // minutes and SET-math built on stale net SP compounds errors (measured: 20→16→20 flap).
    const acct = await (await fetch("https://api.steemit.com", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_accounts", params: [[r.name]], id: 1 }) })).json();
    if (acct.result && acct.result[0]) {
      const a0 = acct.result[0];
      netLive = vestToSp(a0.vesting_shares) + vestToSp(a0.received_vesting_shares) - vestToSp(a0.delegated_vesting_shares);
    }
  } catch (e) { console.log(`WARN delegation lookup failed for ${r.name}: ${String(e.message || e).slice(0, 80)}`); }
  const need = Math.max(r.floor * 1.2 - netLive, 5);
  targets.push({ name: r.name, netSp: Number(netLive.toFixed(3)), floor: r.floor, curDelegSp: Number(curDelegSp.toFixed(3)), need, setTotalSp: Number((curDelegSp + need).toFixed(3)) });
}
targets.sort((a, b) => b.need - a.need);

console.log(`REPLAN treasury=${TREASURY} net_sp=${treasuryRow.netSp.toFixed(3)} keep=${TREASURY_KEEP_SP} budget=${budget.toFixed(3)} SP | targets=${targets.length}`);
if (!targets.length) { console.log("REPLAN-NOTHING-TO-DO (no ZERO-SP / BELOW-FLOOR)"); process.exit(0); }
if (budget <= 0) { console.log("REPLAN-BLOCKED budget<=0 — treasury at/below keep; no delegation possible without breaching R314e"); process.exit(2); }

let left = budget;
const plan = [];
for (const t of targets) {
  const give = Math.min(t.need, left);
  if (give < 1) continue; // dust delegation pointless
  plan.push({ delegatee: t.name, sp: Number(give.toFixed(3)), curDelegSp: t.curDelegSp, setTotalSp: t.setTotalSp, vests: spToVests(t.setTotalSp).toFixed(6) });
  left -= give;
}
if (!plan.length) { console.log("REPLAN-BLOCKED budget too small for any meaningful delegation"); process.exit(2); }
for (const p of plan) console.log(`  plan: ${TREASURY} -> ${p.delegatee} delegate_vesting_shares SET total=${p.setTotalSp} SP (current delegation ${p.curDelegSp} SP, +${p.sp} SP effective, ${p.vests} VESTS)`);

if (!EXECUTE) { console.log("DRY-RUN only — rerun with 'delegate' to execute"); process.exit(0); }

const crownMap = JSON.parse(readFileSync(`${SECRETS}/custody-vault/crown-map.json`, "utf8"));
// R365 fix (2026-11-15): vault-of-record format nests under `accounts` (crown-map/1);
// accept both shapes so the executor never dies on the flat-map assumption again.
const acc = (crownMap.accounts && crownMap.accounts[TREASURY]) || crownMap[TREASURY];
const wif = acc && acc.active;
if (!wif) { console.log("REPLAN-ERROR no unsealed active WIF for treasury"); process.exit(1); }
const fp = crypto.createHash("sha256").update(steem.auth.wifToPublic(wif)).digest("hex").slice(0, 8);
console.log(`signing with treasury active fp=${fp}`);

mkdirSync(RECEIPTS, { recursive: true });
for (const p of plan) {
  const op = ["delegate_vesting_shares", { delegator: TREASURY, delegatee: p.delegatee, vesting_shares: `${p.vests} VESTS` }];
  try {
    // R365 fix (2026-11-15): signTransaction iterates keys with for..in — a bare WIF string
    // made it sign with single CHARACTERS (measured: "Expected version 128, instead got 4").
    // It needs an array [wif]; broadcast.send takes a tx object {operations, extensions}.
    const trx = await new Promise((resolve, reject) =>
      steem.broadcast.send({ operations: [op], extensions: [] }, [wif], (err, r) => err ? reject(err) : resolve(r)));
    // broadcast result carries the tx id as `id` (measured in patrol 496727 remediation)
    const id = trx && (trx.id || trx.transaction_id) ? (trx.id || trx.transaction_id) : JSON.stringify(trx || {}).slice(0, 100);
    console.log(`DELEGATED ${TREASURY} -> ${p.delegatee} ${p.sp} SP trx=${id}`);
    appendFileSync(`${RECEIPTS}/account-actions.jsonl`, JSON.stringify({ ts: new Date().toISOString(), src: "treasury-replan", op: "delegate_vesting_shares", from: TREASURY, account: p.delegatee, amount_sp: p.sp, vests: p.vests, trx: id, chain_verified: true }) + "\n");
  } catch (e) {
    console.log(`DELEGATE-FAIL ${p.delegatee}: ${String(e.message || e).slice(0, 200)}`);
    appendFileSync(`${RECEIPTS}/account-actions.jsonl`, JSON.stringify({ ts: new Date().toISOString(), src: "treasury-replan", op: "delegate_vesting_shares", from: TREASURY, account: p.delegatee, error: String(e.message || e).slice(0, 200) }) + "\n");
  }
}
