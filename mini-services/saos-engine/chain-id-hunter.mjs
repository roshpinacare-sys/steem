import { call } from "./blurt-ser.mjs";
import * as secp from "@noble/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
// pull a real signed tx from a recent blurt block
const dgpo = await call("condenser_api.get_dynamic_global_properties", []);
let tx = null, bn = 0;
for (let d = 3; d < 2500 && !tx; d += 1) {
  bn = dgpo.head_block_number - d;
  const blk = await call("block_api.get_block", { block_num: bn });
  let t = blk.block?.transactions?.[0] ?? blk.transactions?.[0];
  if (t) {
    // appbase object ops → condenser array pairs
    t.operations = t.operations.map(o => Array.isArray(o) ? o : [o.type.replace(/_operation$/, ""), o.value]);
    tx = t;
    console.log("found tx in block", bn, "| ops:", tx.operations.map(o => o[0]).join(","));
  }
}
if (!tx) { console.log("no tx found in scan"); process.exit(1); }
console.log("block:", bn, "| ops:", tx.operations?.map(o => o[0]).join(","));
// node serialization of that exact tx
const stripped = { ref_block_num: tx.ref_block_num, ref_block_prefix: tx.ref_block_prefix, expiration: tx.expiration, operations: tx.operations, extensions: tx.extensions ?? [] };
const ser = await call("condenser_api.get_transaction_hex", [ { ...stripped, extensions: stripped.extensions ?? [] } ]);
console.log("node serialized:", ser.length / 2, "bytes");
// signing pubkey candidates: from the first op — voter/poster/transferor account posting/active pub
let acct = null, role = "posting";
const [opName, opBody] = tx.operations[0];
if (opName === "vote") acct = opBody.voter;
else if (opName === "comment") acct = opBody.author;
else if (opName === "transfer") acct = opBody.from;
else if (opName === "claim_reward_balance") acct = opBody.account;
else { console.log("skipping op type:", opName); process.exit(1); }
const acc = (await call("condenser_api.get_accounts", [[acct]]))[0];
const pubBlt = acc[role]?.key_auths?.[0]?.[0] ?? acc.posting.key_auths[0][0];
console.log("signer:", acct, role, pubBlt.slice(0, 10));
const pubBytes = (() => { const s = pubBlt.slice(3); let n = 0n; for (const c of s) { const i = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz".indexOf(c); n = n * 58n + BigInt(i); } let h = n.toString(16).padStart(2, "0"); if (h.length % 2) h = "0" + h; let buf = Buffer.from(h, "hex"); let pad = 0; for (const c of s) { if (c === "1") pad++; else break; } return Buffer.concat([Buffer.alloc(pad), buf]).slice(0, 33); })();
const pubBytesLen = pubBytes.length;
console.log("pubBytesLen:", pubBytesLen, "first:", Buffer.from(pubBytes).slice(0,2).toString("hex"));
const sigB = Buffer.from(tx.signatures[0], "hex");
console.log("sigLen:", sigB.length, "sigHead:", sigB.slice(0,3).toString("hex"));
const r = sigB.slice(1, 33), s = sigB.slice(33, 65);
const candidates = {
  "zeros": Buffer.alloc(32),
  "blurtjs-cd8d90f2": Buffer.from("cd8d90f29ae273abec3eaa7731e25934c63eb654d55080caff2ebb7f5df6381f", "hex"),
  "hive-beeab0de": Buffer.from("beeab0de00000000000000000000000000000000000000000000000000000000", "hex"),
};
for (const [name, cid] of Object.entries(candidates)) {
  const digest = sha256(Buffer.concat([cid, Buffer.from(ser, "hex")]));
  let ok = false;
  try { ok = secp.verify(Buffer.concat([r, s]), digest, Buffer.from(pubBytes)); } catch (e) { ok = "ERR:" + String(e.message).slice(0, 40); }
  console.log("candidate", name, "→ verify:", ok);
}
