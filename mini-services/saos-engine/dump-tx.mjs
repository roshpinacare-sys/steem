import { call } from "./blurt-ser.mjs";
const dgpo = await call("condenser_api.get_dynamic_global_properties", []);
for (let d = 3; d < 2500; d++) {
  const bn = dgpo.head_block_number - d;
  const blk = await call("block_api.get_block", { block_num: bn });
  const tx = blk.block?.transactions?.[0] ?? blk.transactions?.[0];
  if (tx) { console.log("block", bn); console.log(JSON.stringify(tx, null, 1).slice(0, 900)); break; }
}
