import { buildTx, signDigest, wifDecode } from "./steemtx.mjs";
import * as secp from "@noble/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { readFileSync } from "fs";
const GEN2 = JSON.parse(readFileSync("/tmp/tmp.YT5yhwSTFd/agent/keys/vault.json","utf8"));
const ROT3 = JSON.parse(readFileSync("/tmp/rot3.json","utf8"));
const head = GEN2.accounts.find(a=>a.username==="headcorner");
const dgpo = await (await fetch("https://api.steemit.com",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",method:"condenser_api.get_dynamic_global_properties",params:[],id:1})})).json().then(j=>j.result);
const auth = pub => ({weight_threshold:1,account_auths:[],key_auths:[[pub,1]]});
const op = { account:"headcorner", owner:auth(ROT3.keys.owner.pub), active:auth(ROT3.keys.active.pub), posting:auth(ROT3.keys.posting.pub), memo_key:ROT3.keys.memo.pub, json_metadata:"" };
const headNum=dgpo.head_block_number, idBytes=Buffer.from(String(dgpo.head_block_id),"hex");
const tx = buildTx({ops:[["account_update",op]],dgpo,wifs:[head.keys.owner.wif],chainId:Buffer.alloc(32),ttlSec:60});
const bin = Buffer.from(tx.serializedHex,"hex");
const ownerSecret = wifDecode(head.keys.owner.wif);
const ownerPub = Buffer.from(secp.getPublicKey(Buffer.from(ownerSecret),true));
const sigB = Buffer.from(tx.json.signatures[0],"hex");
const candidates = {
  "A-full-185": bin,
  "B-minus-txext": bin.slice(0,184),
  "C-minus-opext+txext": bin.slice(0,183),
};
const out={};
for(const [name,b] of Object.entries(candidates)){
  const d=sha256(Buffer.concat([Buffer.alloc(32),b]));
  let rec=null;
  try{ const p=secp.recover(sigB.slice(1),d); rec=Buffer.from(p).equals(ownerPub); }catch(e){ rec="err:"+String(e.message).slice(0,30); }
  out[name]={len:b.length, recoversOwnerPub: rec};
}
// also: is the sig self-consistent on full?
const dA=sha256(Buffer.concat([Buffer.alloc(32),bin]));
out["A-full-185"].recoversOwnerPub = secp.verify(sigB.slice(1), dA, ownerPub);
console.log(JSON.stringify(out,null,1));
