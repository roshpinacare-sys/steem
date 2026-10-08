/* ULTIMATE cross-check: take the ACCEPTED founding-post tx, serialize it with
 * our serializer, recover the sig's key, compare to the author's posting key. */
import { serializeTx } from "./steemtx.mjs";
import { rpcCall } from "./measure.mjs";
import { Signature } from "@noble/secp256k1";
import { createHash } from "node:crypto";

const txid = "77c21a926c9623d16c7041f8df75b386660d0617";
let tx = null;
for (const node of ["https://api.justyy.com", "https://api.steemit.com"]) {
  try {
    const r = await fetch(node, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_transaction", params: [txid], id: 1 }) });
    const j = await r.json();
    if (j?.result) { tx = j.result; console.log("got tx from", node); break; }
  } catch {}
}
if (!tx) { console.log("get_transaction unavailable on all nodes"); process.exit(1); }
console.log("ops:", tx.operations.map((o) => o[0] ?? o.type).join(","), "block:", tx.block_num, "sigs:", tx.signatures.length);
const op = tx.operations[0];
const opName = Array.isArray(op) ? op[0] : op.type.replace("_operation", "");
const opBody = Array.isArray(op) ? op[1] : op.value;
const bin = serializeTx({ ref_block_num: tx.ref_block_num, ref_block_prefix: tx.ref_block_prefix, expiration: Math.floor(Date.parse(tx.expiration + (tx.expiration.endsWith("Z") ? "" : "Z")) / 1000), operations: [[opName, opBody]], extensions: tx.extensions ?? [] });
const chainId = Buffer.alloc(32);
const digest = createHash("sha256").update(chainId).update(bin).digest();
const sig = Buffer.from(tx.signatures[0], "hex");
const sigObj = Signature.fromCompact(sig.subarray(1)).addRecoveryBit(sig[0] - 27 - 4);
const pt = sigObj.recoverPublicKey(digest);
const recHex = Buffer.from(pt.toRawBytes(true)).toString("hex");
/* the author's posting key */
const author = opBody.author;
const acc = (await rpcCall("condenser_api.get_accounts", [[author]])).result[0];
const chainPosting = acc.posting.key_auths[0][0];
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
let n = 0n; for (const c of chainPosting.slice(3)) { n = n * 58n + BigInt(B58.indexOf(c)); }
let h = n.toString(16); if (h.length % 2) h = "0" + h; const chainPubBytes = Buffer.from(h.padStart(66, "0").slice(0, 66), "hex").subarray(0, 33);
console.log("recovered-from-chain-sig:", recHex.slice(0, 24));
console.log("author posting key      :", chainPubBytes.toString("hex").slice(0, 24));
console.log("DIGEST FORMULA CONFIRMED:", recHex === chainPubBytes.toString("hex"));
