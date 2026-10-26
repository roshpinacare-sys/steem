/* brute-force the CONSENSUS serialization of account_update2 (the node's own
 * apply-time digest is the judge — txid-oracle doctrine) */
import { signDigest, STEEM_CHAIN_ID, pubkeyBytes } from "./steemtx.mjs";
import { rpcCall } from "./measure.mjs";
import * as fs from "node:fs";
import { createHash } from "node:crypto";
import { Signature } from "@noble/secp256k1";

const cache = JSON.parse(fs.readFileSync("/home/z/my-project/.secrets/army-keys.json", "utf8"));
const g2 = cache.accounts.find((a) => a.name === "hcsoldier4").gens.find((g) => g.gen === "GEN-2");
const acc = (await rpcCall("condenser_api.get_accounts", [["hcsoldier4"]])).result[0];
const dgpo = (await rpcCall("condenser_api.get_dynamic_global_properties", [])).result;
const opBody = { account: "hcsoldier4", owner: null, active: null, posting: null, memo_key: acc.memo_key, json_metadata: "", posting_json_metadata: "{}", extensions: [] };

class Writer {
  constructor() { this.parts = []; }
  bytes(b) { this.parts.push(Buffer.from(b)); return this; }
  varint(n) { n = Number(n); const out = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n); this.parts.push(Buffer.from(out)); return this; }
  u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return this.bytes(b); }
  u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return this.bytes(b); }
  i32(n) { const b = Buffer.alloc(4); b.writeInt32LE(n); return this.bytes(b); }
  str(s) { const b = Buffer.from(String(s ?? ""), "utf8"); this.varint(b.length); return this.bytes(b); }
  pubkey(stm) { return this.bytes(pubkeyBytes(stm)); }
  out() { return Buffer.concat(this.parts); }
}
function serVariant(name, v) {
  const w = new Writer();
  w.varint(43);
  w.str(v.account);
  for (const role of ["owner", "active", "posting"]) w.varint(0);
  const memoOpt = name.includes("memoOpt");
  if (memoOpt) w.varint(1).pubkey(v.memo_key); else w.pubkey(v.memo_key);
  w.str(v.json_metadata ?? "").str(v.posting_json_metadata ?? "");
  if (name.includes("mystery")) w.varint(0);
  if (!name.includes("noExt")) w.varint(0); // op extensions
  return w.out();
}
const variants = ["plainMemo+ext", "plainMemo+mystery+ext", "memoOpt+noExt", "memoOpt+mystery+ext"];
const refNum = dgpo.head_block_number & 0xffff;
const refPrefix = Buffer.from(String(dgpo.head_block_id), "hex").readUInt32LE(4);
const exp = Math.floor(Date.now() / 1000) + 45;

for (const name of variants) {
  const bin = (() => {
    const w = new Writer();
    w.u16(refNum).u32(refPrefix).i32(exp).varint(1);
    const opBytes = serVariant(name, opBody);
    w.bytes(opBytes);
    w.varint(0); // tx extensions
    return w.out();
  })();
  const digest = createHash("sha256").update(STEEM_CHAIN_ID).update(bin).digest();
  const sig = signDigest(digest, g2.activeWif);
  const tx = { ref_block_num: refNum, ref_block_prefix: refPrefix, expiration: new Date(exp * 1000).toISOString().slice(0, 19), operations: [["account_update2", opBody]], extensions: [], signatures: [sig.toString("hex")] };
  const r = await fetch("https://api.steemit.com", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.broadcast_transaction_synchronous", params: [tx], id: 1 }) });
  const j = await r.json();
  const msg = j?.result ? "ACCEPTED!!" : (j?.error?.data?.message ?? j?.error?.message);
  console.log(name, "->", msg);
  if (j?.result) { console.log("WINNER:", name); break; }
}
