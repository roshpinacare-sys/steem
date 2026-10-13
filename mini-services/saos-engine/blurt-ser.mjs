const RPC = "https://blurt-rpc.saboin.com";
import * as secp from "@noble/secp256k1";
import { wifDecode, signDigest } from "./steemtx.mjs";
export class W { constructor(){this.b=[];} u8(v){this.b.push(v&0xff);return this;} u16(v){return this.u8(v).u8(v>>8);} u32(v){return this.u8(v).u8(v>>8).u8(v>>16).u8(v>>>24);} i32(v){return this.u32(v>>>0);} varint(v){v=Number(v);do{let x=v&0x7f;v>>>=7;if(v)x|=0x80;this.u8(x);}while(v);return this;} str(s){const b=Buffer.from(String(s??"") ,"utf8");this.varint(b.length);for(const c of b)this.u8(c);return this;} bytes(buf){for(const c of buf)this.u8(c);return this;} out(){return Buffer.from(this.b);} }
const B58="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(buf){let n=0n;for(const x of buf)n=n*256n+BigInt(x);let s="";while(n>0n){s=B58[Number(n%58n)]+s;n/=58n;}for(const x of buf){if(x===0)s="1"+s;else break;}return s;}
export function pubBytes33(stm){ // accept STM or BLT display prefix; return 33 bytes
  const d=(()=>{const s=stm.slice(3);let n=0n;for(const c of s){const i=B58.indexOf(c);if(i<0)throw new Error("bad-b58");n=n*58n+BigInt(i);}let h=n.toString(16).padStart(2,"0");if(h.length%2)h="0"+h;let buf=Buffer.from(h,"hex");let pad=0;for(const c of s){if(c==="1")pad++;else break;}return Buffer.concat([Buffer.alloc(pad),buf]);})();
  if(d.length!==37)throw new Error("pubkey-length");
  return d.slice(0,33);
}
export function authority(a,w){ w.u32(a.weight_threshold); w.varint((a.account_auths??[]).length); w.varint((a.key_auths??[]).length); for(const [k,wt] of (a.key_auths??[])){ w.bytes(pubBytes33(k)); w.u16(wt); } }

export function serializeBlurtTx({ref_block_num, ref_block_prefix, expiration, op}) {
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
  w.varint(0);                          // tx extensions
  return w.out();
}

export async function call(m,p){const r=await fetch(RPC,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",method:m,params:p,id:1}),signal:AbortSignal.timeout(20000)});const j=await r.json();if(j.error)throw new Error(j.error.message);return j.result;}

