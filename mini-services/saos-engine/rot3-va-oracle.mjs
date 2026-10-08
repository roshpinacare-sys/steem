import { buildTx, signDigest } from "./steemtx.mjs";
import { sha256 } from "@noble/hashes/sha256";
import { readFileSync } from "fs";
const GEN2 = JSON.parse(readFileSync("/tmp/tmp.YT5yhwSTFd/agent/keys/vault.json","utf8"));
const ROT3 = JSON.parse(readFileSync("/tmp/rot3.json","utf8"));
const head = GEN2.accounts.find(a=>a.username==="headcorner");
async function call(m,p){const r=await fetch("https://api.steemit.com",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",method:m,params:p,id:1}),signal:AbortSignal.timeout(20000)});const j=await r.json();if(j.error)throw new Error(j.error.message);return j.result;}
const dgpo = await call("condenser_api.get_dynamic_global_properties",[]);
const auth = pub => ({weight_threshold:1,account_auths:[],key_auths:[[pub,1]]});
const op = { account:"headcorner", owner:auth(ROT3.keys.owner.pub), active:auth(ROT3.keys.active.pub), posting:auth(ROT3.keys.posting.pub), memo_key:ROT3.keys.memo.pub, json_metadata:"" };
const headNum=dgpo.head_block_number, idBytes=Buffer.from(String(dgpo.head_block_id),"hex");
const exp=Math.floor(Date.now()/1000)+120;
const tx = buildTx({ops:[["account_update",op]],dgpo,wifs:[],chainId:Buffer.alloc(32),ttlSec:120,nowSec:exp-120});
const bin=Buffer.from(tx.serializedHex,"hex");
const iso=new Date(exp*1000).toISOString().slice(0,19);
const variants={
  "full185": bin,
  "no-txext184": bin.slice(0,bin.length-1),
  "no-opext-txext183": bin.slice(0,bin.length-2),
};
const out={};
for(const [name,b] of Object.entries(variants)){
  const digest=sha256(Buffer.concat([Buffer.alloc(32),b]));
  const sig=signDigest(Buffer.from(digest),head.keys.owner.wif).toString("hex");
  const trx={ref_block_num:headNum&0xffff,ref_block_prefix:idBytes.readUInt32LE(4),expiration:iso,operations:[["account_update",op]],extensions:[],signatures:[sig]};
  try{
    const va=await call("condenser_api.verify_authority",[trx]);
    out[name]={verify_authority:va===true};
  }catch(e){ out[name]={error:String(e.message).slice(0,80)}; }
}
console.log(JSON.stringify(out,null,1));
