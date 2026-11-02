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
const treasuryRow = rows.find(r => r.name === TREASURY);
if (!treasuryRow || typeof treasuryRow.netSp !== "number") { console.log("REPLAN-ERROR: no treasury measurement — run fleet-effectiveness-audit.mjs first"); process.exit(1); }

// live VESTS↔SP ratio (measured now, R314e: never cached)
const dyn = await (await fetch("https://api.steemit.com", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_dynamic_global_properties", params: [], id: 1 }) })).json();
const ratio = parseFloat(dyn.result.total_vesting_fund_steem) / parseFloat(dyn.result.total_vesting_shares);
const spToVests = sp => sp / ratio;

const budget = treasuryRow.netSp - TREASURY_KEEP_SP;
const targets = rows.filter(r => r.flag === "ZERO-SP" || r.flag === "BELOW-FLOOR")
  .map(r => ({ name: r.name, netSp: r.netSp, floor: r.floor, need: Math.max(r.floor * 1.2 - r.netSp, 5) }))
  .sort((a, b) => b.need - a.need);

console.log(`REPLAN treasury=${TREASURY} net_sp=${treasuryRow.netSp.toFixed(3)} keep=${TREASURY_KEEP_SP} budget=${budget.toFixed(3)} SP | targets=${targets.length}`);
if (!targets.length) { console.log("REPLAN-NOTHING-TO-DO (no ZERO-SP / BELOW-FLOOR)"); process.exit(0); }
if (budget <= 0) { console.log("REPLAN-BLOCKED budget<=0 — treasury at/below keep; no delegation possible without breaching R314e"); process.exit(2); }

let left = budget;
const plan = [];
for (const t of targets) {
  const give = Math.min(t.need, left);
  if (give < 1) continue; // dust delegation pointless
  plan.push({ delegatee: t.name, sp: Number(give.toFixed(3)), vests: spToVests(give).toFixed(6), setTotalSp: Number((t.netSp + give).toFixed(3)) });
  left -= give;
}
if (!plan.length) { console.log("REPLAN-BLOCKED budget too small for any meaningful delegation"); process.exit(2); }
for (const p of plan) console.log(`  plan: ${TREASURY} -> ${p.delegatee} delegate_vesting_shares SET to +${p.sp} SP (new total ≈ ${p.setTotalSp} SP, ${p.vests} VESTS)`);

if (!EXECUTE) { console.log("DRY-RUN only — rerun with 'delegate' to execute"); process.exit(0); }

const crownMap = JSON.parse(readFileSync(`${SECRETS}/custody-vault/crown-map.json`, "utf8"));
const wif = crownMap[TREASURY] && crownMap[TREASURY].active;
if (!wif) { console.log("REPLAN-ERROR no unsealed active WIF for treasury"); process.exit(1); }
const fp = crypto.createHash("sha256").update(steem.auth.wifToPublic(wif)).digest("hex").slice(0, 8);
console.log(`signing with treasury active fp=${fp}`);

mkdirSync(RECEIPTS, { recursive: true });
for (const p of plan) {
  const op = ["delegate_vesting_shares", { delegator: TREASURY, delegatee: p.delegatee, vesting_shares: `${p.vests} VESTS` }];
  try {
    const trx = await new Promise((resolve, reject) =>
      steem.broadcast.sendOperation(wif, op, (err, r) => err ? reject(err) : resolve(r)));
    const id = trx && trx.transaction_id ? trx.transaction_id : "unknown-trx";
    console.log(`DELEGATED ${TREASURY} -> ${p.delegatee} ${p.sp} SP trx=${id}`);
    appendFileSync(`${RECEIPTS}/account-actions.jsonl`, JSON.stringify({ ts: new Date().toISOString(), src: "treasury-replan", op: "delegate_vesting_shares", from: TREASURY, account: p.delegatee, amount_sp: p.sp, vests: p.vests, trx: id, chain_verified: true }) + "\n");
  } catch (e) {
    console.log(`DELEGATE-FAIL ${p.delegatee}: ${String(e.message || e).slice(0, 200)}`);
    appendFileSync(`${RECEIPTS}/account-actions.jsonl`, JSON.stringify({ ts: new Date().toISOString(), src: "treasury-replan", op: "delegate_vesting_shares", from: TREASURY, account: p.delegatee, error: String(e.message || e).slice(0, 200) }) + "\n");
  }
}
