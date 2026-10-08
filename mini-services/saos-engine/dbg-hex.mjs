import { call } from "./blurt-ser.mjs";
const dgpo = await call("condenser_api.get_dynamic_global_properties", []);
let tx = null, bn = 0;
for (let d = 3; d < 2500 && !tx; d++) {
  bn = dgpo.head_block_number - d;
  const blk = await call("block_api.get_block", { block_num: bn });
  let t = blk.block?.transactions?.[0] ?? blk.transactions?.[0];
  if (t) { t.operations = t.operations.map(o => Array.isArray(o) ? o : [o.type.replace(/_operation$/, ""), o.value]); tx = t; }
}
console.log("bn:", bn, "| keys:", Object.keys(tx));
const stripped = { ref_block_num: tx.ref_block_num, ref_block_prefix: tx.ref_block_prefix, expiration: tx.expiration, operations: tx.operations, extensions: tx.extensions ?? [] };
console.log("stripped ops types:", stripped.operations.map(o => [o[0], typeof o[1]]));
console.log("ext:", JSON.stringify(stripped.extensions));
try {
  const ser = await call("condenser_api.get_transaction_hex", [stripped]);
  console.log("hex ok:", ser.slice(0, 40));
} catch (e) { console.log("hex err:", e.message.slice(0, 100)); }
