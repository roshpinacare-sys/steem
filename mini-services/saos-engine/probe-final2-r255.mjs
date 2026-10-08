import { buildTx, pubkeyBytes, signDigest, STEEM_CHAIN_ID } from "./steemtx.mjs";
import { rpcCall } from "./measure.mjs";
import * as fs from "node:fs";
import { createHash } from "node:crypto";
class W {
  constructor() { this.p = []; }
  bytes(b) { this.p.push(Buffer.from(b)); return this; }
  varint(n) { n = Number(n); const o = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; o.push(b); } while (n); this.p.push(Buffer.from(o)); return this; }
  u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return this.bytes(b); }
  u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return this.bytes(b); }
  i32(n) { const b = Buffer.alloc(4); b.writeInt32LE(n); return this.bytes(b); }
  str(s) { const b = Buffer.from(String(s ?? ""), "utf8"); this.varint(b.length); return this.bytes(b); }
  pubkey(stm) { return this.bytes(pubkeyBytes(stm)); }
  out() { return Buffer.concat(this.p); }
}
const cache = JSON.parse(fs.readFileSync("/home/z/my-project/.secrets/army-keys.json", "utf8"));
const g2 = cache.accounts.find((a) => a.name === "hcsoldier4").gens.find((g) => g.gen === "GEN-2");
const dgpo = (await rpcCall("condenser_api.get_dynamic_global_properties", [])).result;
const refNum = dgpo.head_block_number & 0xffff;
const refPrefix = Buffer.from(String(dgpo.head_block_id), "hex").readUInt32LE(4);
const exp = Math.floor(Date.now() / 1000) + 45;
const mk = (opId, opBytes) => {
  const w = new W(); w.u16(refNum).u32(refPrefix).i32(exp).varint(1).varint(opId).bytes(opBytes).varint(0);
  const bin = w.out();
  const digest = createHash("sha256").update(STEEM_CHAIN_ID).update(bin).digest();
  return { bin, sig: signDigest(digest, g2.activeWif).toString("hex"), exp: new Date(exp * 1000).toISOString().slice(0, 19) };
};
const bc = async (tx) => {
  const r = await fetch("https://api.steemit.com", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.broadcast_transaction_synchronous", params: [tx], id: 1 }) });
  const j = await r.json();
  return j?.result ? "ACCEPTED!!" : (j?.error?.data?.message ?? j?.error?.message);
};
/* 1 · cancel WITH op-extensions */
{
  const w = new W(); w.str("hcsoldier4").u32(999999999).varint(0);
  const { bin, sig, exp } = mk(6, w.out());
  console.log("cancel+ext:", await bc({ ref_block_num: refNum, ref_block_prefix: refPrefix, expiration: exp, operations: [["limit_order_cancel", { owner: "hcsoldier4", orderid: 999999999 }]], extensions: [], signatures: [sig] }));
}
/* 2 · account_update2 opt-memo + ext, NO mystery */
{
  const w = new W(); w.str("hcsoldier4").varint(0).varint(0).varint(0).varint(1).pubkey(g2.pub ?? undefined ? g2.pub : undefined ?? "STM1111111111111111111111111111111114T1Anm").str("").str("{}").varint(0);
  const { bin, sig, exp } = mk(43, w.out());
  const acc = (await rpcCall("condenser_api.get_accounts", [["hcsoldier4"]])).result[0];
  const w2 = new W(); w2.str("hcsoldier4").varint(0).varint(0).varint(0).varint(1).pubkey(acc.memo_key).str("").str("{}").varint(0);
  const r2 = mk(43, w2.out());
  console.log("update2 optMemo+ext(no mystery):", await bc({ ref_block_num: refNum, ref_block_prefix: refPrefix, expiration: r2.exp, operations: [["account_update2", { account: "hcsoldier4", owner: null, active: null, posting: null, memo_key: acc.memo_key, json_metadata: "", posting_json_metadata: "{}", extensions: [] }]], extensions: [], signatures: [r2.sig] }));
}
/* 3 · account_update2 PLAIN memo + mystery + ext */
{
  const acc = (await rpcCall("condenser_api.get_accounts", [["hcsoldier4"]])).result[0];
  const w = new W(); w.str("hcsoldier4").varint(0).varint(0).varint(0).pubkey(acc.memo_key).str("").str("{}").varint(0).varint(0);
  const r = mk(43, w.out());
  console.log("update2 plainMemo+mystery+ext:", await bc({ ref_block_num: refNum, ref_block_prefix: refPrefix, expiration: r.exp, operations: [["account_update2", { account: "hcsoldier4", owner: null, active: null, posting: null, memo_key: acc.memo_key, json_metadata: "", posting_json_metadata: "{}", extensions: [] }]], extensions: [], signatures: [r.sig] }));
}
