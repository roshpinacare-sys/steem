/**
 * steemtx.mjs — minimal, self-contained STEEM transaction toolkit.
 * T-12: the operator handed the master credential — the X-1 gate becomes an
 * ENGINE-HELD, DOCTRINE-BOUNDED execution rail.
 *
 * SECURITY CONTRACT (non-negotiable):
 *  - secrets live ONLY in .secrets/ (gitignored, 0600) and in process memory
 *  - nothing in this module ever logs or returns private material
 *  - the only outputs are: public keys, fingerprints, txids, booleans
 *
 * Pure crypto via @noble (audited): sha256, ripemd160, secp256k1 (RFC6979
 * deterministic sigs, canonical low-s — matches chain enforcement).
 */

import { sha256 } from "@noble/hashes/sha256";
import { ripemd160 } from "@noble/hashes/ripemd160";
import { hmac } from "@noble/hashes/hmac";
import * as secp from "@noble/secp256k1";

// noble v2: RFC6979 needs HMAC-SHA256 registered (sync + async) — lives on .etc
/* R245 CRITICAL SIGNING FIX (found 2026-10-07, the silent fleet-killer):
 * @noble/hashes v2 changed hmac() to a SINGLE-message signature
 * (hash, key, message) — the old rest-args patch silently dropped every
 * message after the first, so RFC6979's nonce became CONSTANT across all
 * signatures (same r on every tx by every key!) — (a) a catastrophic key-
 * exposure vector (constant-k ⇒ private key recoverable from two chain
 * sigs) and (b) recid-roulette that made fresh-process broadcasts fail with
 * "missing required active authority" / "unknown key". FIX: concatenate the
 * DRBG messages before hmac — k is per-signature again. */
const concat = (...bufs) => {
  const total = bufs.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const b of bufs) { out.set(b, o); o += b.length; }
  return out;
};
const secpKw = secp.etc || secp.utils;
secpKw.hmacSha256Sync = (key, ...msgs) => hmac(sha256, key, concat(...msgs));
secpKw.hmacSha256Async = async (key, ...msgs) => hmac(sha256, key, concat(...msgs));

/* ── base58 (bitcoin alphabet — same as steem) ──────────────────────────── */
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function b58encode(buf) {
  let n = 0n;
  for (const b of buf) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of buf) { if (b === 0) out = "1" + out; else break; }
  return out;
}
export function b58decode(s) {
  let n = 0n;
  for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error("bad-base58"); n = n * 58n + BigInt(i); }
  let hex = n.toString(16).padStart(2, "0"); if (hex.length % 2) hex = "0" + hex;
  let buf = Buffer.from(hex, "hex");
  let pad = 0; for (const c of s) { if (c === "1") pad++; else break; }
  return Buffer.concat([Buffer.alloc(pad), buf]);
}
const sha256d = (b) => Buffer.from(sha256(Buffer.from(sha256(b))));

/* ── WIF (private key, version 0x80, compressed flag) ───────────────────── */
export function wifEncode(seed32) {
  const body = Buffer.concat([Buffer.from([0x80]), Buffer.from(seed32), Buffer.from([0x01])]);
  const chk = sha256d(body).slice(0, 4);
  return b58encode(Buffer.concat([body, chk]));
}
export function wifDecode(wif) {
  const d = b58decode(wif);
  /* T-86 (measured against the git-vault): BOTH WIF encodings exist in the wild —
   *   38B = 1 ver(0x80) + 32 key + 1 compressed-flag(0x01) + 4 chk  (modern;
   *         checksum covers ver+key+FLAG = 34 bytes)
   *   37B = 1 ver(0x80) + 32 key              + 4 chk  (uncompressed-era —
   *         the vault stores every army key this way; the private key VALUE
   *         is identical, only the flag byte is absent — STEEM pubkeys are
   *         always the compressed point, so derivation is unchanged)
   */
  let body, chk;
  if (d.length === 38) {
    body = d.slice(0, 34); chk = d.slice(34);
    if (body[0] !== 0x80 || body[33] !== 0x01) throw new Error("wif-format");
  } else if (d.length === 37) {
    body = d.slice(0, 33); chk = d.slice(33);
    if (body[0] !== 0x80) throw new Error("wif-format");
  } else {
    throw new Error("wif-length");
  }
  if (!sha256d(body).slice(0, 4).equals(chk)) throw new Error("wif-checksum");
  return body.slice(1, 33);
}

/* ── public key: "STM" + base58(33B compressed || ripemd160(33B)[:4]) ──
 * NOTE: steem pubkey checksum = ripemd160 over the key DIRECTLY (single hash),
 * unlike bitcoin addresses (hash160 = ripemd160(sha256())) — this asymmetry
 * cost us a full verification round; byte-proven against live authorities. */
export function pubkeyFromSeed(seed32) {
  const pub = secp.getPublicKey(Buffer.from(seed32), true); // 33B compressed
  const chk = Buffer.from(ripemd160(Buffer.from(pub))).slice(0, 4);
  return "STM" + b58encode(Buffer.concat([Buffer.from(pub), chk]));
}
export function pubkeyBytes(stm) {
  if (!stm.startsWith("STM")) throw new Error("pubkey-prefix");
  const d = b58decode(stm.slice(3));
  if (d.length !== 37) throw new Error("pubkey-length");
  const key = d.slice(0, 33), chk = d.slice(33);
  if (!Buffer.from(ripemd160(key)).slice(0, 4).equals(chk)) throw new Error("pubkey-checksum");
  return Buffer.from(key);
}

/* ── steem key derivation. steem-js: PrivateKey.fromSeed(seed) = sha256(seed);
 * the seed composition order is verified against on-chain authorities by the
 * caller (signer.mjs tries candidates and keeps the one that matches). ── */
export const SEED_ORDERS = {
  "name+role+pw": (a, r, p) => `${a}${r}${p}`,
  "pw+role+name": (a, r, p) => `${p}${r}${a}`,
  "role+name+pw": (a, r, p) => `${r}${a}${p}`,
  "name+pw+role": (a, r, p) => `${a}${p}${r}`,
};
export function derivePub(seedStr) {
  return pubkeyFromSeed(sha256(Buffer.from(seedStr, "utf8")));
}
export function wifFor(seedStr) {
  return wifEncode(sha256(Buffer.from(seedStr, "utf8")));
}

/* ── binary writer ──────────────────────────────────────────────────────── */
class Writer {
  constructor() { this.buf = []; }
  u8(v) { this.buf.push(v & 0xff); return this; }
  u16(v) { this.buf.push(v & 0xff, (v >> 8) & 0xff); return this; }
  u32(v) { this.buf.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff); return this; }
  i32(v) { return this.u32(v >>> 0); }
  u64(v) { let b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); this.buf.push(...b); return this; }
  i16(v) { return this.u16(v & 0xffff); }
  varint(v) { let n = BigInt(v); while (true) { const b = Number(n & 0x7fn); n >>= 7n; this.u8(n === 0n ? b : b | 0x80); if (n === 0n) break; } return this; }
  bytes(b) { this.buf.push(...b); return this; }
  str(s) { const b = Buffer.from(s, "utf8"); this.varint(b.length); return this.bytes(b); }
  asset(amountStr) {
    // "12.345 STEEM" / "96.123456 VESTS" → the digits themselves ARE the scaled
    // uint64 (precision byte carries the decimal count) — never re-scale
    const m = /^\s*(\d+(?:\.\d+)?)\s+([A-Z]+)\s*$/.exec(amountStr);
    if (!m) throw new Error(`asset-format: ${amountStr}`);
    const whole = m[1]; const sym = m[2];
    const dot = whole.indexOf(".");
    let prec = dot < 0 ? 0 : whole.length - dot - 1;
    /* R210 hardening (adversarial finding B-6): chain-canonical precision is a
     * per-symbol law — STEEM=3, SBD=3, VESTS=6. A caller emitting "0.0 STEEM"
     * (prec 1) would produce non-canonical bytes → fail-closed here. */
    const CANON = { STEEM: 3, SBD: 3, VESTS: 6, TSTD: 6, HIVE: 3, HBD: 3 };
    if (sym in CANON && prec !== CANON[sym]) {
      // rescale rather than reject: pad/truncate the literal to canon precision
      const [i, f = ""] = whole.split(".");
      const f2 = (f + "0".repeat(CANON[sym])).slice(0, CANON[sym]);
      if (BigInt(`${i}${f2}`) !== BigInt(whole.replace(".", ""))) throw new Error(`asset-precision-canon: ${amountStr} (want ${CANON[sym]} decimals)`);
      prec = CANON[sym];
      var scaledStr = `${i}${f2}`;
    } else {
      var scaledStr = whole.replace(".", "");
    }
    const scaled = BigInt(scaledStr);
    this.u64(scaled); this.u8(prec);
    const s = Buffer.from(sym, "ascii");
    this.bytes(Buffer.concat([s, Buffer.alloc(7 - s.length)]));
    return this;
  }
  pubkey(stm) { this.bytes(pubkeyBytes(stm)); return this; }
  authority(a) {
    this.u32(a.weight_threshold ?? 1);
    this.varint((a.account_auths ?? []).length);
    for (const [n, w] of a.account_auths ?? []) { this.str(n); this.u16(w); }
    this.varint((a.key_auths ?? []).length);
    for (const [k, w] of a.key_auths ?? []) { this.pubkey(k); this.u16(w); }
    return this;
  }
  out() { return Buffer.from(this.buf); }
}

/* ── operation serializers (field order = chain registry order) ─────────── */
export const OP_IDS = { vote: 0, comment: 1, transfer: 2, transfer_to_vesting: 3, limit_order_create: 5, limit_order_cancel: 6, convert: 8, account_create: 9, account_update: 10, claim_account: 22, create_claimed_account: 23, claim_reward_balance: 39, custom_json: 18, delegate_vesting_shares: 40, account_update2: 43 };
/* R216 custody-witness: custom_json=18 obtained by CHAIN TRUTH (get_transaction_hex,
 * node-serialized probe 2026-10-05: op-id byte = 0x12 = 18; body fields verified:
 * required_auths vec + required_posting_auths vec + id str + json str). Same method
 * as the R209 claim=39 fix. Single serialization source remains THIS table. */
/* R209 body-fix (restored + chain-re-judged 2026-10-05): claim_reward_balance
 * was 33 here — 19 live broadcasts came back "Missing Posting Authority".
 * CHAIN TRUTH (condenser_api.get_transaction_hex, OBSERVED): claim=39,
 * delegate_vesting_shares=40, vote=0 (control). Single serialization source:
 * this table + serializeOps below. No other byte-builder may exist. */
/* T-91 (2026-10-06): transfer_to_vesting=3 — CHAIN TRUTH probe (get_transaction_hex,
 * unsigned probe tx, byte-for-byte vs serializeTx + empty-signatures vector:
 * op-id byte 0x03 — the FIRST guess of 4 was WRONG (4=withdraw_vesting; the
 * probe caught it, same class as the R209 claim=33→39 fix) — field order
 * from=str,to=str,amount=asset, no memo). Round-3 redeploy rail. */

function serOp(name, v, w) {
  /* R245 CANON (2026-10-07 census, byte-proven per-op against
   * condenser_api.get_transaction_hex): the CURRENT steem protocol appends a
   * trailing extensions vector to EVERY operation — the pre-R245 serializer
   * omitted it, so every op the engine broadcast was one byte short. The live
   * engine kept an in-memory patched copy (parallel-agent fix that was lost
   * from disk) — fresh processes produced digest-mismatched sigs
   * ("missing required active authority" / "unknown key"). The extensions
   * varint(0) below is now part of every op body. THE NODE IS THE ONLY
   * TRUTH — see scripts probe in worklog R245. */
  switch (name) {
    case "comment":
      w.str(v.parent_author ?? "").str(v.parent_permlink).str(v.author).str(v.permlink).str(v.title ?? "").str(v.body ?? "").str(v.json_metadata ?? "{}");
      break;
    case "limit_order_create":
      w.str(v.owner).u32(v.orderid).asset(v.amount_to_sell).asset(v.min_to_receive).u8(v.fill_or_kill ? 1 : 0).i32(v.expiration);
      break;
    case "limit_order_cancel":
      w.str(v.owner).u32(v.orderid);
      break;
    case "convert":
      /* R245-b node-canon REPAIR (2026-10-07T19:5xZ, get_transaction_hex probe,
       * api.steemit.com — THE NODE IS THE ONLY TRUTH): canonical body =
       * owner, requestid(u32), amount(asset), extensions — the R245 session
       * fixed the comment but the implementation kept the pre-R245 order
       * owner, amount, requestid ⇒ every broadcast returned
       * "missing required active authority" (invalid sig over wrong digest).
       * Probe bytes: 08 0a<headcorner> ddd7c378(2026100701) 1027...03"SBD" 00 */
      w.str(v.owner).u32(v.requestid).asset(v.amount);
      break;
    case "transfer":
      w.str(v.from).str(v.to).asset(v.amount).str(v.memo ?? "");
      break;
    case "transfer_to_vesting":
      // T-91 redeploy power-up: from→to (self), amount; NO memo field (chain registry)
      w.str(v.from).str(v.to).asset(v.amount);
      break;
    case "claim_account":
      /* R283 SCHEMA REPAIR — byte-aligned with the OFFICIAL @hiveio/dhive
       * serializer (its live broadcast got past authority to the honest RC
       * error, which our encoding never achieved): body = creator, fee,
       * extensions(empty array = varint 0). The R246 note had the field
       * order REVERSED (fee-first) and the extensions byte stripped — both
       * wrong for THIS op; every claim died "Missing Active Authority"
       * (measured 2026-10-08 18:18-19:0xZ with the fingerprint proving the
       * correct active WIF signed — the digest, not the key, was wrong). */
      w.str(v.creator).asset(v.fee ?? "0.000 STEEM").varint(0);
      break;
    case "create_claimed_account":
      /* R246: phantom extensions byte removed (txid-oracle doctrine —
       * the R245 get_transaction_hex "byte-proven" claim bit us again). */
      w.str(v.creator).str(v.new_account_name)
        .authority(v.owner).authority(v.active).authority(v.posting)
        .pubkey(v.memo_key).str(v.json_metadata ?? "{}");
      break;
    case "account_create":
      /* direct paid creation — bypasses the RC claim wall entirely (3.000 STEEM)
       * R246 CHAIN TRUTH (measured live 2026-10-07T21:26Z): WITH the R245
       * trailing varint(0) the broadcast died "Missing Active Authority
       * headcorner" — the phantom byte corrupts the digest exactly like the
       * vote/cancel/comment case R245-b ruled on. Body = fee,creator,name,
       * owner,active,posting,memo_key,json_metadata — NO extensions byte. */
      w.asset(v.fee).str(v.creator).str(v.new_account_name)
        .authority(v.owner).authority(v.active).authority(v.posting)
        .pubkey(v.memo_key).str(v.json_metadata ?? "{}");
      break;
    case "account_update":
      /* R245 EMERGENCY KEY ROTATION: {account, owner?, active?, posting?,
       * memo_key, json_metadata} — fc optionals = varint(0/1) prefix.
       * Owner-signed; owner keys never broadcast ⇒ never constant-k exposed.
       * 🔴 R255 BYTE-ORACLE REPAIR (2026-10-08, get_transaction_hex byte-diff,
       * node-judged): this op HAS a trailing extensions varint — the R245
       * canon claimed "every op" but THIS case never got it, so every
       * rotation tx was ONE BYTE SHORT (digest mismatch ⇒ "missing required
       * active authority") — the chain-judged proof explains why the R245-ROT2
       * re-sealed keys never went live (the old army's authorities are still
       * GEN-1 — measured live 2026-10-08). memo_key here is PLAIN (op-43's is
       * optional-wrapped — the node's own bytes are the only truth). */
      w.str(v.account);
      for (const role of ["owner", "active", "posting"]) {
        if (v[role]) { w.varint(1).authority(v[role]); } else { w.varint(0); }
      }
      w.pubkey(v.memo_key).str(v.json_metadata ?? "{}").varint(0);
      break;
    case "vote":
      w.str(v.voter).str(v.author).str(v.permlink).i16(v.weight);
      break;
    case "claim_reward_balance":
      w.str(v.account).asset(v.reward_steem).asset(v.reward_sbd).asset(v.reward_vests);
      break;
    case "delegate_vesting_shares":
      /* R245 · id=40 (the R209 CHAIN-TRUTH note). Body: delegator, delegatee,
       * vesting_shares — NO trailing extensions (the 2026-10-07 txid-oracle
       * proved get_transaction_hex ADDS phantom op-extension bytes that the
       * consensus serialization does NOT have — same class as vote/cancel). */
      w.str(v.delegator).str(v.delegatee).asset(v.vesting_shares);
      break;
    case "custom_json":
      /* field order chain-verified via get_transaction_hex probe (R216): vec<string>, vec<string>, id, json */
      w.varint((v.required_auths ?? []).length);
      for (const a of v.required_auths ?? []) w.str(a);
      w.varint((v.required_posting_auths ?? []).length);
      for (const a of v.required_posting_auths ?? []) w.str(a);
      w.str(v.id).str(v.json ?? "{}");
      break;
    case "account_update2":
      /* R255 PROFILE-VISIBILITY (2026-10-08): op id 43 by CHAIN TRUTH probe
       * (get_transaction_hex, node-serialized: op-id byte 0x2b = 43 — same
       * method as R216 custom_json=18 / R209 claim=39 / T-91 ttv=3).
       * WHY IT EXISTS: the custom_json id "update_account_metadata" write was
       * a PHANTOM — the node ACCEPTED the tx (txid returned) but account state
       * never changed (get_accounts json_metadata stayed empty; chain truth
       * beats every claim, the third txid-oracle lesson). The consensus
       * profile write is THIS op. Body: account, owner?/active?/posting?
       * (fc-optional authority: varint(0) = absent), memo_key (fc-optional
       * pubkey: varint(1) flag THEN the 33 bytes — node byte-oracle proved
       * the flag byte), json_metadata, posting_json_metadata, extensions. */
      w.str(v.account);
      for (const role of ["owner", "active", "posting"]) {
        if (v[role]) { w.varint(1).authority(v[role]); } else { w.varint(0); }
      }
      if (v.memo_key) { w.varint(1).pubkey(v.memo_key); } else { w.varint(0); }
      /* 🔴 R255 CONSENSUS-FORM LAW (2026-10-08, the txid-oracle doctrine's
       * sharpest lesson yet): get_transaction_hex's serialization of THIS op
       * carries ONE PHANTOM BYTE the consensus digest does NOT. Four
       * get_transaction_hex-identical variants were rejected
       * ("missing required active authority" / "unknown key"); the accepted
       * broadcast proved the digest form = optional-memo + PLAIN strings +
       * op-extensions, WITHOUT the phantom. THE NODE'S ACCEPT/REJECT IS THE
       * ONLY BYTE ORACLE — get_transaction_hex is a hint, never the judge. */
      w.str(v.json_metadata ?? "").str(v.posting_json_metadata ?? "").varint(0);
      break;
    default:
      throw new Error(`op-not-serializable: ${name}`);
  }
}

/** serialize tx → Buffer (operations as [name, json] pairs) */
export function serializeTx({ ref_block_num, ref_block_prefix, expiration, operations, extensions = [] }) {
  const w = new Writer();
  w.u16(ref_block_num).u32(ref_block_prefix).i32(expiration);
  w.varint(operations.length);
  for (const [name, v] of operations) {
    /* R210 hardening (B-5): a name missing from OP_IDS must fail with a TYPED
     * error, never a raw BigInt TypeError — and never a silent default id. */
    if (!Object.prototype.hasOwnProperty.call(OP_IDS, name)) throw new Error(`op-not-serializable: ${name}`);
    w.varint(OP_IDS[name]);
    serOp(name, v, w);
  }
  /* R210 hardening (B-8): a non-empty extensions array would corrupt the byte
     * stream (only its length varint is written) — fail-closed. */
  if (extensions.length) throw new Error("tx-extensions-unsupported");
  w.varint(extensions.length);
  return w.out();
}

export const STEEM_CHAIN_ID = Buffer.alloc(32); // mainnet chain id = 32 zero bytes
/* R254 · HIVE mainnet chain id — taken from @hiveio/dhive DEFAULT_CHAIN_ID
 * (measured from the official client source, installed+read 2026-10-07),
 * then judged live by the node on the probe broadcast. */
export const HIVE_CHAIN_ID = Buffer.from("beeab0de00000000000000000000000000000000000000000000000000000000", "hex");

/* ── signing ────────────────────────────────────────────────────────────── */
export function signDigest(digest32, wif) {
  const priv = Buffer.from(wifDecode(wif));
  /* גל-99 · תיקון-שורשי מדוד ×3 (נמדד ישירות מול @noble/secp256k1@1.7.2 — המנעול
   * שב-bun.lock): sign() async · signSync() מחזיר טאפל [compact64 = r||s, recId]
   * — לא אובייקט {r,s,recovery} כמו ב-1.6.x (שם הקריסה: "sig.r.toString").
   * הפורמט-על-הסליל שלנו [31+rec][r][s] הוא בדיוק header + compact — ישר-מהטאפל. */
  const [compact, recId] = secp.signSync(Buffer.from(digest32), priv, { der: false, recovered: true }); // deterministic RFC6979, low-s
  return Buffer.concat([Buffer.from([31 + recId]), Buffer.from(compact)]); // [header=31+rec][r][s]
}

/** build + sign a full tx from ops. Returns BOTH the binary digest proof and
 * the JSON form ready for condenser_api.broadcast_transaction.
 * R254: chainId is parameterized — Steem (32 zero bytes) or Hive. */
export function buildTx({ ops, dgpo, wifs, ttlSec = 45, nowSec = Math.floor(Date.now() / 1000), chainId = STEEM_CHAIN_ID }) {
  const headNum = dgpo.head_block_number;
  const idBytes = Buffer.from(String(dgpo.head_block_id), "hex");
  const ref_block_num = headNum & 0xffff;
  const ref_block_prefix = idBytes.length >= 8 ? idBytes.readUInt32LE(4) : 0;
  const expiration = nowSec + ttlSec;
  const iso = (sec) => Number.isFinite(sec) ? new Date(sec * 1000).toISOString().slice(0, 19) : String(sec ?? "");
  const body = { ref_block_num, ref_block_prefix, expiration, operations: ops, extensions: [] };
  const bin = serializeTx({ ...body, expiration });
  const digest = sha256(Buffer.concat([chainId, bin]));
  const sigs = wifs.map((w) => signDigest(Buffer.from(digest), w).toString("hex"));
  return {
    digestHex: Buffer.from(digest).toString("hex"),
    serializedHex: bin.toString("hex"),
    json: { ...body, expiration: iso(expiration), operations: ops.map((op) => { if (!Array.isArray(op)) return op; const [n, v] = op; return [n, { ...v, expiration: v?.expiration ? iso(v.expiration) : undefined, extensions: v && "extensions" in v ? v.extensions : undefined }]; }), signatures: sigs },
  };
}

/* ── asset helpers ──────────────────────────────────────────────────────── */
export function assetOf(n, sym) { return `${Number(n).toFixed(3)} ${sym}`; }
export function fingerprint(s) { return Buffer.from(sha256(Buffer.from(String(s), "utf8"))).toString("hex").slice(0, 8); }
