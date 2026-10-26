import { buildTx, serializeTx, OP_IDS } from "./steemtx.mjs";
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
const nodeHex = await call("condenser_api.get_transaction_hex", [bltJson]);
const myHex = tx.serializedHex;
console.log(JSON.stringify({ myJsonMetadata: (op.json_metadata || "").slice(0, 60), myMetaLen: (op.json_metadata||"").length }, null, 1));
// byte diff map
const N = Buffer.from(nodeHex, "hex"), M = Buffer.from(myHex, "hex");
const diffs = [];
for (let i = 0; i < Math.max(N.length, M.length); i++) if (N[i] !== M[i]) diffs.push(i);
console.log("total: node", N.length, "mine", M.length, "| diff count:", diffs.length, "| first 12 diff positions:", diffs.slice(0, 12));
console.log("node[8..16]:", N.slice(8, 16).toString("hex"), "| mine[8..16]:", M.slice(8, 16).toString("hex"));
console.log("node tail 24:", N.slice(-24).toString("hex"));
console.log("mine tail 24:", M.slice(-24).toString("hex"));
// structural decode of MY bytes: u16, u32, i32-exp, varint(1), varint(10), ...
const exp = M.readUInt32LE(6);
console.log("my decoded: refNum", M.readUInt16LE(0), "refPrefix", M.slice(2,6).toString("hex"), "expU32", exp, "→ISO:", new Date(exp * 1000).toISOString(), "| opsCountVarint", M[10], "opIdVarint", M[11]);
console.log("dgpo.head_block_id:", dgpo.head_block_id, "| expExpected:", dgpo.time);
