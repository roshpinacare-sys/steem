#!/usr/bin/env bun
/**
 * semantic-proof.mjs — prove Steem balance semantics empirically (R234 review)
 * Hypothesis H: account.balance EXCLUDES funds locked in open limit orders.
 * If H is true, TOTAL = balance + Σ(open-order base STEEM) is INVARIANT across samples
 * (only real ops change it), and the engine's "free-balance liquidBasis" is exactly `balance`.
 * If H is false (balance includes locks), TOTAL would swing with the grid's repricing.
 */
const ACCT = "headcorner";
const NODE = "https://api.steemit.com";
async function rpc(method, params) {
  const r = await fetch(NODE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }), signal: AbortSignal.timeout(15000) });
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200));
  return j.result;
}
const naiAmt = (v) => (typeof v === "string" ? parseFloat(v) : v.amount / 10 ** v.precision);

console.log("T(UTC)        balance   locked   TOTAL(=bal+locked)  smallAsks  headroom");
const totals = [];
for (let i = 0; i < 5; i++) {
  const t = new Date().toISOString().slice(11, 19);
  const [acc] = await rpc("condenser_api.get_accounts", [[ACCT]]);
  const bal = naiAmt(acc.balance);
  const res = await rpc("database_api.find_limit_orders", { account: ACCT, limit: 100 });
  let locked = 0, small = 0;
  for (const o of res.orders || []) {
    const a = naiAmt(o.sell_price.base);
    locked += a;
    if (a <= 2) small += a;
  }
  const total = bal + locked;
  totals.push(total);
  console.log(`${t}   ${bal.toFixed(3)}  ${locked.toFixed(3)}  ${total.toFixed(3)}            ${small.toFixed(3)}      ${total - 1023.904 >= -0.001 ? "" : "?"}`);
  if (i < 4) await new Promise((r) => setTimeout(r, 9000));
}
const uniq = [...new Set(totals.map((x) => x.toFixed(3)))];
console.log(`\nTOTAL samples: ${totals.map((x) => x.toFixed(3)).join(" → ")}`);
console.log(uniq.length === 1 ? `INVARIANT CONFIRMED: TOTAL constant at ${uniq[0]} → balance EXCLUDES order locks; engine's free-balance basis is sound (jitter = lock/release by grid, as documented)` : `NOT INVARIANT (${uniq.length} distinct) → semantics differ from hypothesis, engine basis needs review`);
process.exit(uniq.length === 1 ? 0 : 1);
