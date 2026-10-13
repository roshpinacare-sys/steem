#!/usr/bin/env bun
/**
 * reconcile-liquid.mjs — forensic reconciliation (R234 adversarial review)
 * Claim under test: engine's liquidSteem (free balance) === chain raw balance − STEEM locked in open orders
 * Also: liquidSbd === raw SBD − SBD locked.
 * Method: fresh chain reads ONLY (api.steemit.com), zero trust in engine state.
 */
const ACCT = "headcorner";
const NODE = "https://api.steemit.com";
const amt = (v) => (typeof v === "string" ? parseFloat(v) : typeof v === "object" && v ? v.amount / 10 ** v.precision : NaN);
const unit = (v) => (typeof v === "string" ? v.split(" ")[1] : v && v.nai === "@@000000021" ? "STEEM" : v && v.nai === "@@000000013" ? "SBD" : "?");

async function rpc(method, params) {
  const r = await fetch(NODE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }), signal: AbortSignal.timeout(15000) });
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200));
  return j.result;
}

const [acc] = await rpc("condenser_api.get_accounts", [[ACCT]]);
const rawSteem = amt(acc.balance), rawSbd = amt(acc.sbd_balance);

const res = await rpc("database_api.find_limit_orders", { account: ACCT });
const orders = res.orders || [];
let lockSteem = 0, lockSbd = 0, nSteem = 0, nSbd = 0;
for (const o of orders) {
  const u = unit(o.sell_price.base), a = amt(o.sell_price.base);
  if (u === "STEEM") { lockSteem += a; nSteem++; }
  else if (u === "SBD") { lockSbd += a; nSbd++; }
}

// engine's claim from /redeploy (fetched live, not from disk)
const er = await fetch("http://localhost:3040/redeploy").then((r) => r.json());
const engSteem = er.plan.liquidSteem, engSbd = er.plan.liquidSbd;

const freeSteem = rawSteem - lockSteem, freeSbd = rawSbd - lockSbd;
console.log("=== FORENSIC RECONCILIATION ===");
console.log(`chain raw        : STEEM=${rawSteem.toFixed(3)}  SBD=${rawSbd.toFixed(3)}`);
console.log(`open orders      : ${orders.length} (asks ${nSteem} STEEM-sell, bids ${nSbd} SBD-sell)`);
console.log(`locked in orders : STEEM=${lockSteem.toFixed(3)}  SBD=${lockSbd.toFixed(3)}`);
console.log(`derived free     : STEEM=${freeSteem.toFixed(3)}  SBD=${freeSbd.toFixed(3)}`);
console.log(`engine /redeploy : liquidSteem=${engSteem}  liquidSbd=${engSbd}`);
const ds = Math.abs(freeSteem - engSteem), dd = Math.abs(freeSbd - engSbd);
const PASS_S = ds <= 0.002, PASS_D = dd <= 0.002; // tolerance: block-time jitter between reads
console.log(`delta STEEM      : ${ds.toFixed(4)}  → ${PASS_S ? "PASS (≤0.002 jitter)" : "FAIL"}`);
console.log(`delta SBD        : ${dd.toFixed(4)}  → ${PASS_D ? "PASS (≤0.002 jitter)" : "FAIL"}`);
if (!PASS_S || !PASS_D) process.exit(1);
console.log("RECONCILED: engine's free-balance basis matches chain truth");
