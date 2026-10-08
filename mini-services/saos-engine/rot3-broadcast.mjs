/**
 * rot3-broadcast.mjs — Task 25-C: broadcast headcorner STEEM rotation.
 * Byte-law: condenser_api.get_transaction_hex must equal my serialization,
 * then sha256(0x00*32 || bin) digest signed by GEN-2 owner (the key being killed).
 */
import { buildTx, wifDecode, signDigest } from "./steemtx.mjs";
import * as secp from "@noble/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { readFileSync } from "fs";

const RPC = "https://api.steemit.com";
async function call(m, p) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: m, params: p, id: 1 }), signal: AbortSignal.timeout(20000) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
const GEN2 = JSON.parse(readFileSync("/tmp/tmp.YT5yhwSTFd/agent/keys/vault.json", "utf8"));
const ROT3 = JSON.parse(readFileSync("/tmp/rot3.json", "utf8"));
const head = GEN2.accounts.find(a => a.username === "headcorner");
const dgpo = await call("condenser_api.get_dynamic_global_properties", []);
const auth = pub => ({ weight_threshold: 1, account_auths: [], key_auths: [[pub, 1]] });
const op = {
  account: "headcorner",
  owner: auth(ROT3.keys.owner.pub),
  active: auth(ROT3.keys.active.pub),
  posting: auth(ROT3.keys.posting.pub),
  memo_key: ROT3.keys.memo.pub,
  json_metadata: "",
};
const headNum = dgpo.head_block_number;
const idBytes = Buffer.from(String(dgpo.head_block_id), "hex");
const exp = Math.floor(Date.now() / 1000) + 60;
const tx = buildTx({ ops: [["account_update", op]], dgpo, wifs: [], chainId: Buffer.alloc(32), ttlSec: 60 });
const nodeHex = await call("condenser_api.get_transaction_hex", [{ ref_block_num: headNum & 0xffff, ref_block_prefix: idBytes.readUInt32LE(4), expiration: new Date(exp * 1000).toISOString().slice(0, 19), operations: [["account_update", op]], extensions: [] }]);
const byteMatch = nodeHex === tx.serializedHex;
console.log(JSON.stringify({ byteMatch, nodeLen: nodeHex.length / 2, myLen: tx.serializedHex.length }));
if (!byteMatch) process.exit(2);
// CONSENSUS-FORM LAW (node-oracle 2026-10-08): steem tx digest covers the
// serialized tx WITHOUT the tx-level extensions byte (op-level ext INCLUDED).
// verify_authority(full185)=FAIL / verify_authority(no-txext184)=TRUE.
const digest = sha256(Buffer.concat([Buffer.alloc(32), Buffer.from(tx.serializedHex, "hex").slice(0, tx.serializedHex.length / 2 - 1)]));
const sig = signDigest(digest, head.keys.owner.wif);
const secret = wifDecode(head.keys.owner.wif);
const selfOk = secp.verify(sig.slice(1), digest, Buffer.from(secp.getPublicKey(Buffer.from(secret), true)));
console.log(JSON.stringify({ signatureSelfVerified: selfOk }));
if (!selfOk) process.exit(3);
const b = await call("condenser_api.broadcast_transaction_synchronous", [{ ...tx.json, signatures: [sig.toString("hex")] }]);
console.log(JSON.stringify({ txid: String(b?.result?.id ?? b?.id ?? "").slice(0, 16), block: b?.result?.block_num ?? null, verdict: "BROADCASTED" }));
