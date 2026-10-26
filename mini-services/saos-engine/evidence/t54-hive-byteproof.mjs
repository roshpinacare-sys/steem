// T-54 · HIVE SHAPE VALIDATION: 4 tx shapes vs the chain's own serializer.
// THE LAWS THIS FILE PROVES (all measured against api.hive.blog):
//   1. HIVE_CHAIN_ID = beeab0de…00, ADDRESS_PREFIX = STM (key derivation drop-in)
//   2. condenser_api.get_transaction_hex takes the tx OBJECT (not [object])
//   3. Hive txs carry ONE extra trailing varint(0) — ours+NUL === chain
//   4. Asset symbols serialize as LEGACY names: "HIVE"→STEEM bytes, "HBD"→SBD bytes
//   5. op-level expiration is an ISO string in the JSON form (number crashes the parser)
import { serializeTx, serializeHiveTx, hiveRemapOps } from "../steemtx.mjs";
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first"); // measured: sandbox has no IPv6 route

const HIVE_ENDPOINTS = ["https://api.hive.blog", "https://api.openhive.network"];
const rpc = async (method, params) => {
  let lastErr = null;
  for (const url of HIVE_ENDPOINTS) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(12000) });
      const j = await r.json();
      if (j?.error) throw new Error(String(j.error.message).slice(0, 100));
      return j.result;
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error("all hive endpoints failed");
};
const withRetry = async (fn, n = 5) => {
  let last = null;
  for (let i = 0; i < n; i++) {
    try { return await fn(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 4000)); }
  }
  throw last;
};

// the JSON form keeps HIVE names (the chain converts them itself) but the op-level
// expiration must be an ISO string in JSON (measured: a number crashes the parser)
const hiveRemapJson = (ops) => (ops ?? []).map(([name, v]) => [
  name,
  v && typeof v === "object" && "expiration" in v && typeof v.expiration === "number" ? { ...v, expiration: iso(v.expiration) } : v,
]);

const dgpo = await withRetry(() => rpc("condenser_api.get_dynamic_global_properties", []));
const idB = Buffer.from(String(dgpo.head_block_id), "hex");
const refN = dgpo.head_block_number & 0xffff, refP = idB.readUInt32LE(4);
const exp = Math.floor(Date.now() / 1000) + 45;
const iso = (s) => new Date(s * 1000).toISOString().slice(0, 19);

const cases = [
  { name: "vote-only", ops: [["vote", { voter: "headcorner", author: "hiveio", permlink: "x", weight: 5000 }]] },
  { name: "transfer-HIVE", ops: [["transfer", { from: "headcorner", to: "hiveio", amount: "1.000 HIVE", memo: "" }]] },
  { name: "transfer-HBD", ops: [["transfer", { from: "headcorner", to: "hiveio", amount: "0.500 HBD", memo: "saos" }]] },
  { name: "order+vote+transfer", ops: [
      ["limit_order_create", { owner: "headcorner", orderid: 42, amount_to_sell: "1.000 HIVE", min_to_receive: "0.056 HBD", fill_or_kill: false, expiration: exp + 3600 }],
      ["vote", { voter: "headcorner", author: "hiveio", permlink: "x", weight: 10000 }],
      ["transfer", { from: "headcorner", to: "hiveio", amount: "0.001 HBD", memo: "" }],
  ] },
];

let all = true;
for (const c of cases) {
  const out = await withRetry(async () => {
    // EXACTLY the production path: serializeHiveTx (remap + tail) for the bytes,
    // the JSON form (HIVE names + ISO strings) for the chain's own serializer
    const bin = serializeHiveTx({ ref_block_num: refN, ref_block_prefix: refP, expiration: exp, operations: c.ops, extensions: [] });
    const json = { ref_block_num: refN, ref_block_prefix: refP, expiration: iso(exp), operations: hiveRemapJson(c.ops), extensions: [] };
    const chainHex = String(await rpc("condenser_api.get_transaction_hex", [json]));
    return { ours: bin.toString("hex"), chainHex };
  });
  const ok = out.chainHex === out.ours; // serializeHiveTx already carries the tail — full-byte comparison
  all = all && ok;
  console.log(c.name.padEnd(18), "| ours === chain:", ok, "| len", out.ours.length / 2, "vs", out.chainHex.length / 2);
  if (!ok) { console.log("  ours :", out.ours); console.log("  chain:", out.chainHex); }
}
console.log(all ? "\nHIVE LAWS CONFIRMED: our Steem serializer + one trailing NUL byte = the chain's own binary — the signing stack is byte-compatible with Hive (minus credentials, which stay operator-gated)." : "\nMISMATCH — laws not confirmed, do not build");
process.exit(all ? 0 : 2);
