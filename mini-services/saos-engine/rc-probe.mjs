/**
 * rc-probe.mjs — ONE-OFF empirical RC measurement (T-19 HYPER-GRID groundwork).
 * Measures the real chain cost of limit_order_create / limit_order_cancel ops
 * by broadcasting 4 dust orders + 4 cancels through the REAL signing rail and
 * reading the RC manabar delta with exact regen correction.
 * Dust orders are 5x/0.1% of market — immortal-dust by construction, and they
 * expire in 120s even if cleanup fails. Zero fill risk, zero capital risk.
 */
import { rpcCall } from "./measure.mjs";
import { executeOps, masterAccount, loadCredential } from "./signer.mjs";

const ACC = masterAccount();
loadCredential();

const readMana = async () => {
  const r = await rpcCall("rc_api.find_rc_accounts", { accounts: [ACC] });
  const a = r.result?.rc_accounts?.[0];
  return { cur: parseInt(a.rc_manabar.current_mana, 10), max: parseInt(a.max_rc, 10), t: Date.now() };
};
const regenBetween = (a, b) => Math.floor(a.max * (b.t - a.t) / (5 * 86400 * 1000));
const ms = (p) => new Promise((r) => setTimeout(r, p));

const m0 = await readMana();
const tSec = Math.floor(Date.now() / 1000);
const ids = [];
const ops = [];
for (let i = 0; i < 2; i++) {
  const idA = (tSec + 1_000_000 + i * 2) >>> 0;
  const idB = (idA + 1) >>> 0;
  ids.push(idA, idB);
  // ask 0.5 STEEM at 0.5 SBD/STEEM (~5x market — never fills; expires 120s)
  ops.push(["limit_order_create", { owner: ACC, orderid: idA, amount_to_sell: "0.500 STEEM", min_to_receive: "0.250 SBD", fill_or_kill: false, expiration: tSec + 120 }]);
  // bid 0.5 SBD at 0.001 SBD/STEEM (~1% of market — never fills; expires 120s)
  ops.push(["limit_order_create", { owner: ACC, orderid: idB, amount_to_sell: "0.500 SBD", min_to_receive: "500.000 STEEM", fill_or_kill: false, expiration: tSec + 120 }]);
}
console.log("probing with", ops.length, "create ops...");
const r1 = await executeOps(ops, { tag: "rc-probe" });
console.log("creates:", r1.verdict, r1.txid ?? "", r1.error ?? "");
await ms(6000);
const m1 = await readMana();

const cancelOps = ids.map((id) => ["limit_order_cancel", { owner: ACC, orderid: id }]);
console.log("probing with", cancelOps.length, "cancel ops...");
const r2 = await executeOps(cancelOps, { tag: "rc-probe-cancel" });
console.log("cancels:", r2.verdict, r2.txid ?? "", r2.error ?? "");
await ms(6000);
const m2 = await readMana();

const spentCreate = m0.cur + regenBetween(m0, m1) - m1.cur;
const spentCancel = m1.cur + regenBetween(m1, m2) - m2.cur;
const out = {
  maxRc: m0.max,
  regenPerDay: Math.floor(m0.max * 0.2),
  createCostEach: spentCreate > 0 ? Math.round(spentCreate / 4) : null,
  cancelCostEach: spentCancel > 0 ? Math.round(spentCancel / 4) : null,
  spentCreate, spentCancel,
  sustainableOpsPerDay: spentCreate > 0 ? Math.floor(Math.floor(m0.max * 0.2) / (spentCreate / 4)) : null,
  verdicts: [r1.verdict, r2.verdict],
};
console.log("PROBE_RESULT " + JSON.stringify(out, null, 2));
