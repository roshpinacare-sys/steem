/**
 * blurt-rotate.mjs — Task 25: sovereign blurt authority rotation (army).
 * BLURT BYTE-TRUTH (node-oracle + official blurtjs serializer, 2026-10-08):
 *   op account_update = id 6 (blurt removed limit_order_cancel/feed_publish/
 *   convert/account_create from steem's enum) with body:
 *   account | owner? | active? | posting? | memo_key? (fc-optional!) |
 *   json_metadata | posting_json_metadata | extensions — then tx extensions.
 * GEN-1 active (custody backup 09-09) signs; GEN-2 pubs go live; owner untouched.
 * Byte-law: broadcast only when get_transaction_hex == my serialization.
 */
import { wifDecode, buildTx, signDigest } from "./steemtx.mjs";
import { createHash } from "node:crypto";
import * as secp from "@noble/secp256k1";
import { readFileSync } from "fs";
import { createHash } from "crypto";

const RPC = "https://blurt-rpc.saboin.com";
const CHAIN_ID = Buffer.from("cd8d90f29ae273abec3eaa7731e25934c63eb654d55080caff2ebb7f5df6381f", "hex");

class W { constructor(){this.b=[];} u8(v){this.b.push(v&0xff);return this;} u16(v){return this.u8(v).u8(v>>8);} u32(v){return this.u8(v).u8(v>>8).u8(v>>16).u8(v>>>24);} i32(v){return this.u32(v>>>0);} varint(v){v=Number(v);do{let x=v&0x7f;v>>>=7;if(v)x|=0x80;this.u8(x);}while(v);return this;} str(s){const b=Buffer.from(String(s??"") ,"utf8");this.varint(b.length);for(const c of b)this.u8(c);return this;} bytes(buf){for(const c of buf)this.u8(c);return this;} out(){return Buffer.from(this.b);} }
const B58="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(buf){let n=0n;for(const x of buf)n=n*256n+BigInt(x);let s="";while(n>0n){s=B58[Number(n%58n)]+s;n/=58n;}for(const x of buf){if(x===0)s="1"+s;else break;}return s;}
function pubBytes33(stm){ // accept STM or BLT display prefix; return 33 bytes
  const d=(()=>{const s=stm.slice(3);let n=0n;for(const c of s){const i=B58.indexOf(c);if(i<0)throw new Error("bad-b58");n=n*58n+BigInt(i);}let h=n.toString(16).padStart(2,"0");if(h.length%2)h="0"+h;let buf=Buffer.from(h,"hex");let pad=0;for(const c of s){if(c==="1")pad++;else break;}return Buffer.concat([Buffer.alloc(pad),buf]);})();
  if(d.length!==37)throw new Error("pubkey-length");
  return d.slice(0,33);
}
function authority(a,w){ w.u32(a.weight_threshold); w.varint((a.account_auths??[]).length); w.varint((a.key_auths??[]).length); for(const [k,wt] of (a.key_auths??[])){ w.bytes(pubBytes33(k)); w.u16(wt); } }

function serializeBlurtTx({ref_block_num, ref_block_prefix, expiration, op}) {
  const w = new W();
  w.u16(ref_block_num).u32(ref_block_prefix).i32(expiration);
  w.varint(1); // one operation
  w.varint(6); // BLURT account_update = 6 (node-oracle proven)
  w.str(op.account);
  for (const role of ["owner","active","posting"]) {
    if (op[role]) { w.varint(1); authority(op[role], w); } else w.varint(0);
  }
  if (op.memo_key) { w.varint(1); w.bytes(pubBytes33(op.memo_key)); } else w.varint(0);
  w.str(op.json_metadata ?? "");       // json_metadata
  w.str(op.posting_json_metadata ?? ""); // blurt-extra string
  w.varint(0);                          // op extensions
  w.varint(0);                          // node-oracle extra zero (probe-proven 2026-10-08)
  w.varint(0);                          // tx extensions
  return w.out();
}

async function call(m,p){const r=await fetch(RPC,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",method:m,params:p,id:1}),signal:AbortSignal.timeout(20000)});const j=await r.json();if(j.error)throw new Error(j.error.message);return j.result;}

const GEN1 = JSON.parse(readFileSync(process.env.GEN1_VAULT,"utf8"));
const GEN2 = JSON.parse(readFileSync(process.env.GEN2_VAULT,"utf8"));
const gen1 = {}; for (const a of GEN1.accounts) gen1[a.username]=a.keys??{};
const TARGETS=(process.env.TARGETS??"").split(",").filter(Boolean);
const DRYRUN=process.env.DRY_RUN==="1";
const dgpo=await call("condenser_api.get_dynamic_global_properties",[]);
const out={at:new Date().toISOString(),dryRun:DRYRUN,results:[]};
for (const u of TARGETS) {
  const res={account:u};
  try{
    const k1=gen1[u]; const k2=(GEN2.accounts.find(a=>a.username===u)).keys;
    if(!k1?.active?.wif)throw new Error("no-gen1-active-in-custody");
    const [acct]=await call("condenser_api.get_accounts",[[u]]);
    const op={
      account:u,
      active:{weight_threshold:1,account_auths:[],key_auths:[[String(k2.active.pub),1]]},
      posting:{weight_threshold:1,account_auths:[],key_auths:[[String(k2.posting.pub),1]]},
      memo_key:String(k2.memo.pub),
      json_metadata:acct.json_metadata?? "",
    };
    const headNum=dgpo.head_block_number;
    const idBytes=Buffer.from(String(dgpo.head_block_id),"hex");
    const exp=Math.floor(Date.now()/1000)+60;
    const bin=serializeBlurtTx({ref_block_num:headNum&0xffff,ref_block_prefix:idBytes.readUInt32LE(4),expiration:exp,op});
    // BYTE-LAW: node must serialize my tx identically
    const iso=new Date(exp*1000).toISOString().slice(0,19);
    const bltPubStr=s=>typeof s==="string"&&s.startsWith("STM")?"BLT"+s.slice(3):s;
    const bltOp={...op,active:{...op.active,key_auths:op.active.key_auths.map(([k,w])=>[bltPubStr(k),w])},posting:{...op.posting,key_auths:op.posting.key_auths.map(([k,w])=>[bltPubStr(k),w])},memo_key:bltPubStr(op.memo_key)};
    const probe={ref_block_num:headNum&0xffff,ref_block_prefix:idBytes.readUInt32LE(4),expiration:iso,operations:[["account_update",bltOp]],extensions:[]};
    const nodeHex=await call("condenser_api.get_transaction_hex",[probe]);
    res.byteMatch = nodeHex === bin.toString("hex");
    if(!res.byteMatch){ res.verdict="BYTE-MISMATCH"; res.nodeLen=nodeHex.length/2; res.myLen=bin.length; out.results.push(res); continue; }
    const digest=(()=>{const h=createHash("sha256");h.update(CHAIN_ID);h.update(bin);return h.digest();})();
    const sig=signDigest(Buffer.from(digest),k1.active.wif).toString("hex");
    // local verify: sig must verify against the GEN-1 active pubkey bytes
    const secret=wifDecode(k1.active.wif);
    const pubOk=secp.verify(Buffer.from(sig,"hex").slice(1),digest,Buffer.from(secp.getPublicKey(Buffer.from(secret),true)));
    res.signatureSelfVerified=pubOk;
    if(!pubOk){res.verdict="SIG-SELF-VERIFY-FAIL";out.results.push(res);continue;}
    if(DRYRUN){res.verdict="DRY-OK";out.results.push(res);continue;}
    const b=await call("condenser_api.broadcast_transaction_synchronous",[{...probe,signatures:[sig]}]);
    res.txid=String(b?.result?.id??b?.id??"").slice(0,12);
    res.block=b?.result?.block_num??null;
    res.verdict=res.txid?"BROADCASTED":"NO-TXID";
  }catch(e){res.verdict="FAIL";res.error=String(e).slice(0,140);}
  out.results.push(res);
}
console.log(JSON.stringify(out,null,1));
