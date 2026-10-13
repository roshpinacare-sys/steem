/* is our sig by the right key over our digest? and which digest does the node accept? */
import { buildTx, serializeTx, STEEM_CHAIN_ID } from "./steemtx.mjs";
import { rpcCall } from "./measure.mjs";
import { Signature } from "@noble/secp256k1";
import * as fs from "node:fs";
import { createHash } from "node:crypto";
const cache = JSON.parse(fs.readFileSync("/home/z/my-project/.secrets/army-keys.json", "utf8"));
const g2 = cache.accounts.find((a) => a.name === "hcsoldier4").gens.find((g) => g.gen === "GEN-2");
const acc = (await rpcCall("condenser_api.get_accounts", [["hcsoldier4"]])).result[0];
const meta = JSON.stringify({ profile: { name: "First Draft Ledger", about: "Learning in public: first drafts, shown work, the arithmetic of small habits.", interests: ["learning", "drafts"] } });
const ops = [["account_update2", { account: "hcsoldier4", owner: null, active: null, posting: null, memo_key: acc.memo_key, json_metadata: "", posting_json_metadata: meta, extensions: [] }]];
const dgpo = (await rpcCall("condenser_api.get_dynamic_global_properties", [])).result;
const tx = buildTx({ ops, dgpo, wifs: [g2.activeWif] });
const sigBuf = Buffer.from(tx.json.signatures[0], "hex");
const pubExpected = Buffer.from(await (async () => {
  const { pubkeyFromSeed, wifDecode } = await import("./steemtx.mjs");
  const hex = pubkeyFromSeed(wifDecode(String(g2.activeWif).trim())).slice(3);
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n; for (const c of hex) { n = n * 58n + BigInt(B58.indexOf(c)); }
  let h = n.toString(16); if (h.length % 2) h = "0" + h; let buf = Buffer.from(h, "hex");
  let pad = 0; for (const c of hex) { if (c === "1") pad++; else break; }
  return Buffer.concat([Buffer.alloc(pad), buf]).subarray(0, 33);
})());
const digest = Buffer.from(tx.digestHex, "hex");
const sigObj = Signature.fromCompact(sigBuf.subarray(1)).addRecoveryBit(sigBuf[0] - 27 - 4);
const recLocal = sigObj.recoverPublicKey(digest);
console.log("local recovery of own profile sig:", Buffer.from(recLocal.toRawBytes(true)).toString("hex").slice(0, 20));
console.log("expected active:", pubExpected.toString("hex").slice(0, 20));
console.log("local recovery match:", Buffer.from(recLocal.toRawBytes(true)).toString("hex") === pubExpected.toString("hex"));
/* alternative digests */
const bin = Buffer.from(tx.serializedHex, "hex");
const d2 = createHash("sha256").update(STEEM_CHAIN_ID).update(bin).update(Buffer.from([0])).digest();
console.log("verify vs digest+sigcount-byte:", secp.verify(sigBuf.subarray(1), d2, pubExpected));
/* broadcast with a NEW tx re-signed over D2 (fresh expiration) */
const tx2 = buildTx({ ops, dgpo, wifs: [g2.activeWif] });
const bin2 = Buffer.from(tx2.serializedHex, "hex");
const dAlt = createHash("sha256").update(STEEM_CHAIN_ID).update(bin2).update(Buffer.from([0])).digest();
const alt = { ...tx2.json, signatures: [signAlt(dAlt, g2.activeWif)] };
function signAlt(digestBytes, wif) {
  return signDigest(digestBytes, wif).toString("hex");
}
const r = await fetch("https://api.steemit.com", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.broadcast_transaction_synchronous", params: [alt], id: 1 }) });
const j = await r.json();
const sigData = j?.error?.data?.stack?.find((s) => s?.data?.sigs)?.data ?? null;
console.log("alt-digest broadcast:", j?.result ? "ACCEPTED" : (j?.error?.data?.message ?? j?.error?.message), sigData ? "recovered:" + JSON.stringify(sigData.sigs) : "");
