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
async function probe(json_metadata, posting_json_metadata){
  const exp=Math.floor(Date.now()/1000)+60;
  const iso=new Date(exp*1000).toISOString().slice(0,19);
  const op={...base,json_metadata,posting_json_metadata};
  const probeTx={ref_block_num:headNum&0xffff,ref_block_prefix:idBytes.readUInt32LE(4),expiration:iso,operations:[["account_update",{...op,active:{...op.active,key_auths:op.active.key_auths.map(([k,w])=>[blt(k),w])},posting:{...op.posting,key_auths:op.posting.key_auths.map(([k,w])=>[blt(k),w])},memo_key:blt(op.memo_key)}]],extensions:[]};
  const hex=await call("condenser_api.get_transaction_hex",[probeTx]);
  const N=Buffer.from(hex,"hex");
  return { len: N.length, tail: N.slice(-16).toString("hex") };
}
console.log("C (both empty):", JSON.stringify(await probe("","")));
console.log("A (json=AAAA): ", JSON.stringify(await probe("AAAA","")));
console.log("B (pj=BBBB):   ", JSON.stringify(await probe("","BBBB")));
console.log("D (both=AAAA): ", JSON.stringify(await probe("AAAA","AAAA")));
