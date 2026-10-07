#!/usr/bin/env bun
/**
 * audit-powerups.mjs — adversarial cross-source ground-truth audit (R232 review)
 * Method: two independent Steem nodes; compare byte-level; never trust local logs.
 * Checks:
 *  1. All transfer_to_vesting ops of headcorner today (UTC) — from BOTH nodes
 *  2. Cross-node byte-level agreement on those ops
 *  3. Verify R231 txid 52be9256d2121cb9bf87d414486bfdac177f3fb3 (23.143 STEEM)
 *  4. get_accounts balance cross-node
 *  5. Compare on-chain count vs engine's powerUpsToday claim
 */
const ACCT = "headcorner";
const R231_TXID = "52be9256d2121cb9bf87d414486bfdac177f3fb3";
const TODAY = "2026-10-07T00:00:00";
const NODES = [
  { name: "A:api.steemit.com", url: "https://api.steemit.com" },
  { name: "B:api.steem.fans", url: "https://api.steem.fans" },
];
const PAGE = 100; // condenser hard limit per get_account_history call
const FAILS = [];
const ok = (label, detail) => console.log(`  PASS  ${label}${detail ? "  — " + detail : ""}`);
const bad = (label, detail) => { console.log(`  FAIL  ${label}  — ${detail}`); FAILS.push(label); };

async function rpc(node, method, params) {
  const r = await fetch(node.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${node.name} ${method}: ${JSON.stringify(j.error).slice(0, 200)}`);
  return j.result;
}

console.log("=== 1+2. transfer_to_vesting today — both nodes, byte-level ===");
const perNode = {};
for (const node of NODES) {
  let ops = [];
  try {
    // paginate backwards until we pass yesterday's boundary
    let start = -1, guard = 0;
    while (guard++ < 60) {
      const page = await rpc(node, "condenser_api.get_account_history", [ACCT, start, PAGE - 1]);
      ops = page.map(([, v]) => v).concat(ops);
      const oldest = page[0][1].timestamp;
      if (oldest < TODAY) break;
      start = page[0][0] - 1;
      if (start < -1) break;
    }
    var hist = ops;
  } catch (e) { bad(`history-fetch ${node.name}`, e.message); continue; }
  // NOTE: pagination already flattened [idx, val] pairs to val objects
  const pu = hist
    .filter((v) => v && v.op && v.op[0] === "transfer_to_vesting" && v.timestamp >= TODAY)
    .map((v) => ({
      trx: v.trx_id, ts: v.timestamp, block: v.block,
      from: v.op[1].from, to: v.op[1].to, amount: v.op[1].amount,
    }));
  perNode[node.name] = pu;
  console.log(`  ${node.name}: ${pu.length} transfer_to_vesting ops today`);
  for (const p of pu) console.log(`    ${p.ts}  ${p.amount}  →${p.to}  trx=${p.trx}`);
}
const names = Object.keys(perNode);
if (names.length === 2) {
  const a = JSON.stringify(perNode[names[0]], null, 0);
  const b = JSON.stringify(perNode[names[1]], null, 0);
  if (a === b && perNode[names[0]].length > 0) ok("cross-node byte-level agreement", `${perNode[names[0]].length} ops identical`);
  else if (a === b && perNode[names[0]].length === 0) bad("no power-ups found on-chain today", "engine claims 4 — investigate");
  else bad("cross-node disagreement", "nodes returned different op lists");
}

console.log("\n=== 3. R231 txid verification (both nodes) ===");
for (const node of NODES) {
  try {
    const tx = await rpc(node, "condenser_api.get_transaction", [R231_TXID]);
    const op = tx.operations.find((o) => o[0] === "transfer_to_vesting");
    if (!op) { bad(`txid on ${node.name}`, "tx exists but not transfer_to_vesting"); continue; }
    const [otype, o] = op;
    const amt = parseFloat(o.amount);
    const selfDirected = o.from === o.to;
    const detail = `block=${tx.block_num} op=${otype} ${o.amount} from=${o.from} to=${o.to} self=${selfDirected}`;
    if (amt === 23.143 && selfDirected && o.to === ACCT) ok(`R231 txid on ${node.name}`, detail);
    else bad(`R231 txid on ${node.name}`, detail);
  } catch (e) { bad(`R231 txid on ${node.name}`, e.message.slice(0, 150)); }
}

console.log("\n=== 4. get_accounts cross-node ===");
const accts = {};
for (const node of NODES) {
  try {
    const [a] = await rpc(node, "condenser_api.get_accounts", [[ACCT]]);
    accts[node.name] = {
      balance: a.balance, sbd_balance: a.sbd_balance,
      vesting_shares: a.vesting_shares, to_withdraw: a.to_withdraw, withdrawn: a.withdrawn,
    };
    console.log(`  ${node.name}: STEEM=${a.balance} SBD=${a.sbd_balance} VESTS=${a.vesting_shares}`);
  } catch (e) { bad(`get_accounts ${node.name}`, e.message.slice(0, 150)); }
}
if (accts[NODES[0].name] && accts[NODES[1].name]) {
  const s = JSON.stringify(accts[NODES[0].name]) === JSON.stringify(accts[NODES[1].name]);
  s ? ok("account state agrees across nodes") : bad("account state disagreement", JSON.stringify(accts));
}

console.log("\n=== 5. On-chain count vs engine claim ===");
const chainCount = perNode[names[0]] ? perNode[names[0]].length : -1;
console.log(`  on-chain today (node A): ${chainCount}`);
console.log(`  engine /redeploy claim : powerUpsToday=4, lastPowerUpAt=2026-10-07T01:24:54Z`);
if (chainCount === 4) ok("on-chain count matches engine claim (4)");
else if (chainCount < 0) bad("could not fetch history", "node A failed");
else bad("count mismatch", `chain=${chainCount} vs claim=4`);

console.log("\n=== VERDICT ===");
if (FAILS.length === 0) console.log("ALL CHECKS PASSED — independent ground truth confirms engine claims");
else { console.log(`FAILED CHECKS: ${FAILS.length}`); FAILS.forEach((f) => console.log("  - " + f)); process.exit(1); }
