import { buildTx } from "./steemtx.mjs";
import { readFileSync } from "fs";
const GEN1 = JSON.parse(readFileSync(process.env.GEN1_VAULT, "utf8"));
const GEN2 = JSON.parse(readFileSync(process.env.GEN2_VAULT, "utf8"));
const k2 = GEN2.accounts.find(a => a.username === "cashmachine").keys;
async function call(m,p){const r=await fetch("https://blurt-rpc.saboin.com",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",method:m,params:p,id:1}),signal:AbortSignal.timeout(15000)});const j=await r.json();if(j.error)throw new Error(j.error.message);return j.result;}
const dgpo = await call("condenser_api.get_dynamic_global_properties",[]);
const acct = (await call("condenser_api.get_accounts",[["cashmachine"]]))[0];
const op = {
  account: "cashmachine",
  active: { weight_threshold: 1, account_auths: [], key_auths: [[String(k2.active.pub), 1]] },
  posting: { weight_threshold: 1, account_auths: [], key_auths: [[String(k2.posting.pub), 1]] },
  memo_key: String(k2.memo.pub),
  json_metadata: acct.json_metadata ?? "",
};
const CHAIN_ID = Buffer.from("cd8d90f29ae273abec3eaa7731e25934c63eb654d55080caff2ebb7f5df6381f", "hex");
const tx = buildTx({ ops: [["account_update", op]], dgpo, wifs: [], chainId: CHAIN_ID, ttlSec: 60 });
const bltJson = JSON.parse(JSON.stringify(tx.json, (k, v) => typeof v === "string" && v.startsWith("STM") ? "BLT" + v.slice(3) : v));
delete bltJson.signatures;
const nodeHex = await call("condenser_api.get_transaction_hex", [bltJson]);
const N = Buffer.from(nodeHex, "hex");
// structural decode of node bytes
let p = 0;
const u16 = () => { const v = N.readUInt16LE(p); p += 2; return v; };
const u32 = () => { const v = N.readUInt32LE(p); p += 4; return v; };
const u8 = () => N[p++];
const varint = () => { let r = 0, s = 0, b; do { b = N[p++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return r; };
const str = () => { const l = varint(); const s = N.slice(p, p + l).toString(); p += l; return s; };
const pub = () => { const s = N.slice(p, p + 33).toString("hex"); p += 33; return s; };
console.log("txHeader: refNum", u16(), "refPrefix", u32().toString(16), "exp", new Date(u32() * 1000).toISOString().slice(0, 19), "opsCount", varint());
console.log("opId:", varint());
console.log("account:", str());
const authority = () => { const t = u32(); const na = varint(); const nk = varint(); const keys = []; for (let i = 0; i < nk; i++) keys.push(pub().slice(0, 8) + ":" + u16()); return { threshold: t, accountAuths: na, keys }; };
const readAuth = () => { const flag = varint(); return flag ? authority() : "ABSENT"; };
console.log("owner:", readAuth());
console.log("active:", readAuth());
console.log("posting:", readAuth());
const memoFlag = varint();
console.log("memoFlag:", memoFlag, "memoPub:", memoFlag ? pub().slice(0, 8) : "ABSENT");
const jsonMeta = str();
console.log("jsonMetadata:", JSON.stringify(jsonMeta));
console.log("bytesLeft:", N.length - p, "remaining:", N.slice(p).toString("hex"));
console.log("FULL NODE HEX:", nodeHex);
console.log("expectedNewActivePub:", String(k2.active.pub).slice(0, 10), "expectedPostingPub:", String(k2.posting.pub).slice(0, 10), "memo:", String(k2.memo.pub).slice(0, 10));
