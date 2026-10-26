/* R210 §III · CHAIN-JUDGED SERIALIZATION VERIFICATION (read-only, zero broadcast, zero keys).
 * The chain's own get_transaction_hex is the canonical serializer — we compare
 * our OP_IDS table against it. GOLDEN TEST VECTOR, OBSERVED evidence. */
const RPC = "https://api.steemit.com";

const CLAIM = ["claim_reward_balance", { account: "headcorner", reward_steem: "0.000 STEEM", reward_sbd: "0.000 SBD", reward_vests: "0.000000 VESTS" }];
const DELEGATE = ["delegate_vesting_shares", { delegator: "headcorner", delegatee: "hcsoldier4", vesting_shares: "5460.000000 VESTS" }];

async function hex(trx) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_transaction_hex", params: [trx], id: 1 }) }).then((x) => x.json());
  if (r.error) return { error: r.error.message };
  return { hex: r.result };
}

function opIdFromHex(h) {
  const buf = Buffer.from(h, "hex");
  // trx: ref_block_num u16 | ref_block_prefix u32 | expiration u32 | ops varint-count | [op varint-id ...]
  const count = buf[10]; // 1 op → count byte at 10 (no varint multi-byte for 1)
  const id = buf[11];
  return { count, id, head: buf.subarray(0, 14).toString("hex"), opBytes: buf.subarray(11).toString("hex").slice(0, 60) };
}

const base = { ref_block_num: 0, ref_block_prefix: 0, expiration: "2026-10-05T19:30:00", extensions: [] };

console.log("== claim_reward_balance (chain-canonical bytes) ==");
const c = await hex({ ...base, operations: [CLAIM] });
console.log(c.error ? `RPC-ERROR: ${c.error}` : JSON.stringify(opIdFromHex(c.hex)));

console.log("== delegate_vesting_shares (chain-canonical bytes) ==");
const d = await hex({ ...base, operations: [DELEGATE] });
console.log(d.error ? `RPC-ERROR: ${d.error}` : JSON.stringify(opIdFromHex(d.hex)));

console.log("== vote (known-good control, expected id 0) ==");
const v = await hex({ ...base, operations: [["vote", { voter: "headcorner", author: "headcorner", permlink: "x", weight: 0 }]] });
console.log(v.error ? `RPC-ERROR: ${v.error}` : JSON.stringify(opIdFromHex(v.hex)));
