import { buildTx } from "./steemtx.mjs";
import { readFileSync } from "fs";
const GEN1 = JSON.parse(readFileSync(process.env.GEN1_VAULT, "utf8"));
const GEN2 = JSON.parse(readFileSync(process.env.GEN2_VAULT, "utf8"));
const k1 = GEN1.accounts.find(a => a.username === "cashmachine").keys;
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
try {
  const hex = await call("condenser_api.get_transaction_hex", [bltJson]);
  const mine = tx.serializedHex;
  console.log(JSON.stringify({ nodeLen: hex.length / 2, myLen: mine.length / 2, equal: hex === mine }, null, 1));
  if (hex !== mine) {
    for (let i = 0; i < Math.min(hex.length, mine.length); i += 2) {
      if (hex.slice(i, i + 2) !== mine.slice(i, i + 2)) {
        console.log(JSON.stringify({ firstDiffByte: i / 2, node: hex.slice(Math.max(0,i-20), i+40), mine: mine.slice(Math.max(0,i-20), i+40) }));
        break;
      }
    }
    console.log("node_tail:", hex.slice(-60), "\nmy_tail:", mine.slice(-60));
  }
} catch (e) { console.log("oracle-error:", String(e).slice(0, 200)); }
