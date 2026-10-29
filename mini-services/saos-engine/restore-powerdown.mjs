/* restore-powerdown.mjs — re-establish the owner-approved power down (B1 sequence:
 * soldiers first, the rest down). Measured first, broadcast second, read back third.
 * The 08:58Z withdraw-0 cancel was unattributed; this restores the 08:49Z measured value. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { buildTx } from "./steemtx.mjs";

const wif = JSON.parse(readFileSync("/home/z/fleet/steem/.secrets/custody-vault/headcorner-active.json", "utf8")).headcorner.active;
const ACC = "headcorner";

const rpc = async (method, params, node = "https://api.steemit.com") => {
  const r = await fetch(node, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json();
  if (j.error) throw new Error(String(j.error.message).slice(0, 300));
  return j.result;
};

const mNorm = (x) => { const n = parseFloat(x ?? 0); return Number.isFinite(n) && n > 5e11 ? n / 1e6 : n; };

// 1. MEASURE on-chain (the evaluator, not the condenser cache)
const [acc] = await rpc("condenser_api.get_accounts", [[ACC]]);
const vests = mNorm(acc.vesting_shares);
const delegated = mNorm(acc.delegated_vesting_shares);
const toWithdraw = mNorm(acc.to_withdraw);
const withdrawn = mNorm(acc.withdrawn);
console.log(`measured: vests=${vests.toFixed(6)} delegated=${delegated.toFixed(6)} to_withdraw=${toWithdraw.toFixed(6)} withdrawn=${withdrawn.toFixed(6)}`);
const free = vests - delegated;
console.log(`free (power-down-able ceiling): ${free.toFixed(6)} VESTS = ${(free / 1610.4745).toFixed(2)} SP`);

// the 08:49Z measured value (owner-approved, leaves ~10K VESTS buffer)
const TARGET = 2028803.218642;
if (TARGET > free) throw new Error(`target ${TARGET} exceeds free ${free} — refuse`);
const amt = `${TARGET.toFixed(6)} VESTS`;

// 2. broadcast
const dgpo = await rpc("condenser_api.get_dynamic_global_properties", []);
const ops = [["withdraw_vesting", { account: ACC, vesting_shares: amt }]];
const tx = buildTx({ ops, dgpo, wifs: [wif], ttlSec: 60 });
let ok = false, lastErr = "";
for (const node of ["https://api.steemit.com", "https://api.justyy.com"]) {
  try {
    const r = await fetch(node, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.broadcast_transaction", params: [tx.json], id: 1 }),
      signal: AbortSignal.timeout(12000),
    });
    const j = await r.json();
    if (j.error) { lastErr = String(j.error.message).slice(0, 200); console.log(`  ${node} REJECT: ${lastErr}`); continue; }
    ok = true; console.log(`  ${node} ACCEPTED`); break;
  } catch (e) { lastErr = String(e?.message ?? e).slice(0, 160); }
}
if (!ok) { console.error("broadcast FAILED:", lastErr); process.exit(1); }

// 3. post-broadcast chain readback (B10 law)
await new Promise((r) => setTimeout(r, 3000));
const [acc2] = await rpc("condenser_api.get_accounts", [[ACC]]);
console.log(`readback: to_withdraw=${mNorm(acc2.to_withdraw).toFixed(6)} rate=${mNorm(acc2.vesting_withdraw_rate).toFixed(6)}/week next_payout=${acc2.next_vesting_withdrawal}`);
const restored = Math.abs(mNorm(acc2.to_withdraw) - TARGET) < 1;
console.log(`VERDICT: ${restored ? "POWER-DOWN RESTORED (chain-verified)" : "READBACK-MISMATCH"}`);

// 4. receipt
mkdirSync("/home/z/fleet/steem/receipts", { recursive: true });
writeFileSync("/home/z/fleet/steem/receipts/powerdown-restore-2026-10-29.json", JSON.stringify({
  at: new Date().toISOString(), event: "POWERDOWN-RESTORE",
  target: amt, weeklyRate: `${(TARGET / 4 / 1610.4745).toFixed(2)} SP/week`,
  broadcastOk: ok, readbackOk: restored,
  law: "owner-approved 2026-10-29 (B1 sequence: soldiers first, the rest down); the 08:58Z unattributed cancel is registered in MISTAKES-REGISTRY",
  nextPayout: acc2.next_vesting_withdrawal,
}, null, 1));
console.log("receipt written");
