import { call } from "./blurt-ser.mjs";
import * as secp from "@noble/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
const dgpo = await call("condenser_api.get_dynamic_global_properties", []);
let tx = null, bn = 0;
const SAFE = new Set(["vote", "comment", "transfer", "claim_reward_balance"]);
for (let d = 3; d < 2500 && !tx; d++) {
  bn = dgpo.head_block_number - d;
  const blk = await call("block_api.get_block", { block_num: bn });
  let t = blk.block?.transactions?.[0] ?? blk.transactions?.[0];
  if (t) {
    t.operations = t.operations.map(o => Array.isArray(o) ? o : [o.type.replace(/_operation$/, ""), o.value]);
    for (const [, body] of t.operations) {
      for (const k of Object.keys(body)) if (body[k] && typeof body[k] === "object" && !Array.isArray(body[k])) body[k] = JSON.stringify(body[k]);
    }
    if (SAFE.has(t.operations[0][0])) tx = t;
  }
}
if (!tx) { console.log("no safe tx in scan"); process.exit(1); }
const stripped = { ref_block_num: tx.ref_block_num, ref_block_prefix: tx.ref_block_prefix, expiration: tx.expiration, operations: tx.operations, extensions: tx.extensions ?? [] };
const ser = Buffer.from(await call("condenser_api.get_transaction_hex", [stripped]), "hex");
const opName = tx.operations[0][0], opBody = tx.operations[0][1];
const acct = opName === "vote" ? opBody.voter : opName === "comment" ? opBody.author : opName === "transfer" ? opBody.from : (opBody.account ?? opBody.delegator ?? opBody.required_posting_auths?.[0] ?? opBody.required_auths?.[0] ?? null);
if (!acct) { console.log("unhandled op:", opName); process.exit(1); }
const acc = (await call("condenser_api.get_accounts", [[acct]]))[0];
const pubKeys = new Set();
for (const role of ["owner", "active", "posting"]) for (const [k] of acc[role].key_auths) pubKeys.add(k);
const pubs = [...pubKeys].map(k => {
  const s = k.slice(3); let n = 0n; const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  for (const c of s) n = n * 58n + BigInt(B58.indexOf(c));
  let h = n.toString(16).padStart(2, "0"); if (h.length % 2) h = "0" + h;
  let buf = Buffer.from(h, "hex"); let pad = 0; for (const c of s) { if (c === "1") pad++; else break; }
  return Buffer.concat([Buffer.alloc(pad), buf]).slice(0, 33);
});
console.log("signer:", acct, "| pubs:", pubs.length, "| sigs:", tx.signatures.length);
const candidates = {
  zeros: Buffer.alloc(32),
  blurtjs_full: Buffer.from("cd8d90f29ae273abec3eaa7731e25934c63eb654d55080caff2ebb7f5df6381f", "hex"),
  blurtjs_prefix_zeros: Buffer.concat([Buffer.from("cd8d90f2", "hex"), Buffer.alloc(28)]),
  sha256_blurt: sha256(Buffer.from("blurt")),
  sha256_BLURT: sha256(Buffer.from("BLURT")),
};
let found = null;
for (const [name, cid] of Object.entries(candidates)) {
  const digest = sha256(Buffer.concat([cid, ser]));
  for (let si = 0; si < tx.signatures.length && !found; si++) {
    const sigB = Buffer.from(tx.signatures[si], "hex");
    const sig = sigB.slice(1);
    for (const p of pubs) {
      let ok = false;
      try { ok = secp.verify(sig, digest, Buffer.from(p)); } catch {}
      if (ok) { found = { chainId: cid.toString("hex"), name, sigIdx: si, pub: p.slice(0, 6).toString("hex") }; break; }
    }
  }
  console.log("candidate", name, found ? "★FOUND★" : "no");
  if (found) break;
}
console.log(found ? JSON.stringify(found) : "NO-MATCH");
