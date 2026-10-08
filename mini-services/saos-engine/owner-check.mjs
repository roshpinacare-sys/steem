import { wifDecode } from "./steemtx.mjs";
import * as secp from "@noble/secp256k1";
import { ripemd160 } from "@noble/hashes/ripemd160";
import { readFileSync } from "fs";
const B58="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(buf){let n=0n;for(const x of buf)n=n*256n+BigInt(x);let s="";while(n>0n){s=B58[Number(n%58n)]+s;n/=58n;}for(const x of buf){if(x===0)s="1"+s;else break;}return s;}
function stmPub(sec){const pub=secp.getPublicKey(Buffer.from(sec),true);const chk=Buffer.from(ripemd160(Buffer.from(pub))).slice(0,4);return "STM"+b58(Buffer.concat([Buffer.from(pub),chk]));}
const GEN2 = JSON.parse(readFileSync("/tmp/tmp.YT5yhwSTFd/agent/keys/vault.json","utf8"));
const head = GEN2.accounts.find(a=>a.username==="headcorner");
const r = await fetch("https://api.steemit.com",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",method:"condenser_api.get_accounts",params:[["headcorner"]],id:1})});
const a=(await r.json()).result[0];
const liveOwner=a.owner.key_auths[0][0], liveActive=a.active.key_auths[0][0], livePosting=a.posting.key_auths[0][0];
const out={at:new Date().toISOString()};
for(const role of ["owner","active","posting","memo"]){
  const held=stmPub(wifDecode(head.keys[role].wif));
  const live={owner:liveOwner,active:liveActive,posting:livePosting,memo:a.memo_key}[role];
  out[role]={heldPub:held.slice(0,10),livePub:live.slice(0,10),match:held===live};
}
console.log(JSON.stringify(out,null,1));
