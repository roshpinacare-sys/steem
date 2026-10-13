#!/usr/bin/env node
/* CHAIN-NATIVE PROBE (R242) — empirical inventory of native Steem "contracts".
 * Law: docs/CHAIN-NATIVE-SOVEREIGNTY.md — claims about the chain are measured, never asserted.
 * Validates operation support via condenser_api.get_required_signatures (read-only, never broadcasts).
 * Exit: 0 = full expected set supported | 2 = missing expected ops (recorded) */
const NODE = process.env.SAOS_NODE ?? "https://api.steemit.com";
const tx = (op) => ({ ref_block_num: 0, ref_block_prefix: 0, expiration: "2030-01-01T00:00:00", operations: [op], extensions: [] });
const OPS = {
  custom_json: ["custom_json", { required_auths: [], required_posting_auths: ["headcorner"], id: "saos-probe-v1", json: "{}" }],
  account_update: ["account_update", { account: "headcorner", owner: { weight_threshold: 1, account_auths: [], key_auths: [] }, active: { weight_threshold: 1, account_auths: [], key_auths: [] }, posting: { weight_threshold: 1, account_auths: [], key_auths: [] }, json_metadata: "{}" }],
  escrow_transfer: ["escrow_transfer", { from: "headcorner", to: "headcorner", agent: "headcorner", escrow_id: 1, hbd_amount: "0.000 SBD", steem_amount: "1.000 STEEM", fee: "0.100 SBD", memo: "", json_meta: "{}", expiration: "2030-01-01T00:00:00", ratification_deadline: "2029-01-01T00:00:00" }],
  create_proposal: ["create_proposal", { creator: "headcorner", receiver: "headcorner", start_date: "2030-01-01T00:00:00", end_date: "2030-02-01T00:00:00", daily_pay: "1.000 SBD", subject: "probe", permlink: "probe" }],
  delegate_vesting_shares: ["delegate_vesting_shares", { delegator: "headcorner", delegatee: "headcorner", vesting_shares: "0.000000 VESTS" }],
  set_recurring_transfer: ["set_recurring_transfer", { from: "headcorner", to: "headcorner", amount: "1.000 STEEM", memo: "", recurrence: 24, executions: 2 }],
};

const out = {};
for (const [name, op] of Object.entries(OPS)) {
  try {
    const r = await fetch(NODE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_required_signatures", params: [tx(op), []], id: 1 }) }).then((x) => x.json());
    out[name] = r.error ? `UNSUPPORTED (${String(r.error?.data?.message ?? "").slice(0, 40)})` : "SUPPORTED";
  } catch (e) { out[name] = `ERROR (${String(e).slice(0, 40)})`; }
}
console.log(JSON.stringify({ at: new Date().toISOString(), node: NODE, native: out }, null, 2));
const expect = ["custom_json", "account_update", "escrow_transfer", "create_proposal", "delegate_vesting_shares"];
process.exit(expect.every((k) => out[k] === "SUPPORTED") ? 0 : 2);
