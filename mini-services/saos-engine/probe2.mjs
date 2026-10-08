import { call } from "./blurt-ser.mjs";
import { readFileSync } from "fs";
const GEN2 = JSON.parse(readFileSync("/tmp/tmp.YT5yhwSTFd/agent/keys/vault.json","utf8"));
const k2 = GEN2.accounts.find(a=>a.username==="cashmachine").keys;
const dgpo = await call("condenser_api.get_dynamic_global_properties",[]);
const headNum=dgpo.head_block_number, idBytes=Buffer.from(String(dgpo.head_block_id),"hex");
const base = {
  account:"cashmachine",
  active:{weight_threshold:1,account_auths:[],key_auths:[[String(k2.active.pub),1]]},
  posting:{weight_threshold:1,account_auths:[],key_auths:[[String(k2.posting.pub),1]]},
  memo_key:String(k2.memo.pub),
};
const blt=s=>typeof s==="string"&&s.startsWith("STM")?"BLT"+s.slice(3):s;
async function hexOf(json_metadata, posting_json_metadata){
  const exp=Math.floor(Date.now()/1000)+60;
  const iso=new Date(exp*1000).toISOString().slice(0,19);
  const op={...base,json_metadata,posting_json_metadata};
  const probeTx={ref_block_num:headNum&0xffff,ref_block_prefix:idBytes.readUInt32LE(4),expiration:iso,operations:[["account_update",{...op,active:{...op.active,key_auths:op.active.key_auths.map(([k,w])=>[blt(k),w])},posting:{...op.posting,key_auths:op.posting.key_auths.map(([k,w])=>[blt(k),w])},memo_key:blt(op.memo_key)}]],extensions:[]};
  return Buffer.from(await call("condenser_api.get_transaction_hex",[probeTx]),"hex");
}
const A = await hexOf("AAAA","");   // json only
const B = await hexOf("","BBBB");   // pj only
const D = await hexOf("AAAA","AAAA"); // both
// memo pub bytes end position: find pubBytes of memo in each (33 bytes)
const { pubBytes33 } = await import("./blurt-ser.mjs");
const memoB = pubBytes33(blt(base.memo_key));
const findEnd = (N) => N.lastIndexOf(memoB) + 33;
for (const [name, N] of [["A",A],["B",B],["D",D]]) {
  const e = findEnd(N);
  console.log(name, "len", N.length, "memoEnd", e, "tailBytes:", N.slice(e).toString("hex"));
}
