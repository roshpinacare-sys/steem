/**
 * master-rotate.mjs — ROTATION TO OWNER-HELD KEYS (2026-10-12)
 * Directive: "וודא שאני יכול להיכנס... אני לא רוצה לשמוע על זה יותר"
 * Law: new keys = steem-js official generateKeys(name, password, role)
 *      secret(role) = sha256(normalize(name + role + master_password))
 * Sign: current live owner WIF (vault) — owner authority sets all roles.
 * Byte-law: condenser_api.get_transaction_hex === local serialization.
 * Output: fingerprints + verdicts ONLY. Zero key material printed.
 */
// noble version shim: engine written for .etc namespace (v2) — 1.7.x uses .utils
const secpMod = await import("@noble/secp256k1");

const { buildTx, wifDecode, signDigest } = await import("./steemtx.mjs");
import { sha256 } from "@noble/hashes/sha256";
import { ripemd160 } from "@noble/hashes/ripemd160";
import { base58 } from "@scure/base";
import { readFileSync } from "fs";

const RPC = "https://api.steemit.com";
async function call(m, p) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: m, params: p, id: 1 }), signal: AbortSignal.timeout(25000) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
const DRY = process.argv.includes("--dry");
const MASTER = readFileSync("/home/z/.secrets/keys/headcorner.txt", "utf8").split(/\r?\n/).map(x => x.trim()).filter(Boolean)[1];
const ACCOUNT = "headcorner";
const VAULT = JSON.parse(readFileSync("/home/z/.secrets/vault-unsealed/agent/keys/vault.json", "utf8"));
const head = VAULT.accounts.find(a => a.username === ACCOUNT);

function toSTM(sec) {
  const pub = secpMod.getPublicKey(sec, true);
  const cs = ripemd160(pub).slice(0, 4);
  return "STM" + base58.encode(new Uint8Array([...pub, ...cs]));
}
// steem-js generateKeys normalization: trim + collapse whitespace runs
function normSeed(s) { return s.trim().split(/[\t\n\v\f\r ]+/).join(" "); }
function newSecret(role) { return sha256(Buffer.from(normSeed(ACCOUNT + role + MASTER), "utf8")); }
function wifEncode(secret) {
  const body = new Uint8Array([0x80, ...secret, 0x01]);
  const chk = sha256(sha256(body)).slice(0, 4);
  return base58.encode(new Uint8Array([...body, ...chk]));
}

const newKeys = {};
for (const role of ["owner", "active", "posting", "memo"]) {
  const secret = newSecret(role);
  newKeys[role] = { wif: wifEncode(secret), pub: toSTM(secret) };
}
// sanity: new WIFs roundtrip
for (const role of Object.keys(newKeys)) {
  const back = wifDecode(newKeys[role].wif);
  if (!Buffer.from(back).equals(Buffer.from(newSecret(role)))) throw new Error("roundtrip-fail:" + role);
}

const dgpo = await call("condenser_api.get_dynamic_global_properties", []);
const auth = pub => ({ weight_threshold: 1, account_auths: [], key_auths: [[pub, 1]] });
const op = {
  account: ACCOUNT,
  owner: auth(newKeys.owner.pub),
  active: auth(newKeys.active.pub),
  posting: auth(newKeys.posting.pub),
  memo_key: newKeys.memo.pub,
  json_metadata: "",
};
const headNum = dgpo.head_block_number;
const idBytes = Buffer.from(String(dgpo.head_block_id), "hex");
const exp = Math.floor(Date.now() / 1000) + 60;
const tx = buildTx({ ops: [["account_update", op]], dgpo, wifs: [], chainId: Buffer.alloc(32), ttlSec: 60 });
const nodeHex = await call("condenser_api.get_transaction_hex", [{ ref_block_num: headNum & 0xffff, ref_block_prefix: idBytes.readUInt32LE(4), expiration: new Date(exp * 1000).toISOString().slice(0, 19), operations: [["account_update", op]], extensions: [] }]);
const byteMatch = nodeHex === tx.serializedHex;
console.log(JSON.stringify({ byteMatch, nodeLen: nodeHex.length / 2, myLen: tx.serializedHex.length / 2 }));
if (!byteMatch) process.exit(2);

const digest = sha256(Buffer.concat([Buffer.alloc(32), Buffer.from(tx.serializedHex, "hex").slice(0, tx.serializedHex.length / 2 - 1)]));
const sig = signDigest(digest, head.keys.owner.wif);
const secret = wifDecode(head.keys.owner.wif);
const selfOk = secpMod.verify(sig.slice(1), digest, Buffer.from(secpMod.getPublicKey(Buffer.from(secret), true)));
console.log(JSON.stringify({ signatureSelfVerified: selfOk, signer: "current-owner (vault)", fp_owner_new: sha256(newKeys.owner.wif).toString("hex").slice(0, 8), fp_active_new: sha256(newKeys.active.wif).toString("hex").slice(0, 8) }));
if (!selfOk) process.exit(3);
if (DRY) { console.log(JSON.stringify({ verdict: "DRY-OK (not broadcast)" })); process.exit(0); }

const b = await call("condenser_api.broadcast_transaction_synchronous", [{ ...tx.json, signatures: [sig.toString("hex")] }]);
console.log(JSON.stringify({ txid: String(b?.result?.id ?? b?.id ?? "").slice(0, 16), block: b?.result?.block_num ?? null, verdict: "BROADCASTED" }));

// verify: live authorities now match password-derived keys
await new Promise(r => setTimeout(r, 3000));
const [acct] = await call("condenser_api.get_accounts", [[ACCOUNT]]);
const auth2 = {
  owner: (acct.owner?.key_auths || []).map(k => k[0]),
  active: (acct.active?.key_auths || []).map(k => k[0]),
  posting: (acct.posting?.key_auths || []).map(k => k[0]),
  memo: [acct.memo_key],
};
const verdicts = {};
for (const role of ["owner", "active", "posting", "memo"]) verdicts[role] = auth2[role].includes(newKeys[role].pub) ? "VERIFIED-BIT-EXACT" : "MISMATCH";
console.log(JSON.stringify({ postRotationVerification: verdicts, last_owner_update: acct.last_owner_update }));
