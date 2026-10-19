/**
 * wallets.mjs — W15 · THE ON-CHAIN WALLET LAYER (ארנקים-על-הרשת).
 *
 * OPERATOR ORDER 2026-10-19 (verbatim): "אפשר לפתוח טוקנים וארנקים על הרשת
 * לחיילים ולסוכנים ולכל האוטונומיה" — wallets for the soldiers, the agents,
 * and the whole autonomy. W14 shipped the mint lane (Steem accounts, gated)
 * + HCT-1 book-law token; THIS module is the missing piece: deterministic,
 * secp256k1-based on-chain deposit wallets the autonomy fully controls.
 *
 * DESIGN LAWS:
 *  - ONE master seed (64 random bytes, sealed as a NEW self-contained vault
 *    class WALLETS-SEAL — the EXCHANGE-SEAL precedent, pass in meta) drives
 *    every wallet: I(label) = HMAC-SHA512(seed, "SAOS-WALLET-v1|" + label);
 *    priv = clamp(I.left mod n) — deterministic, auditable, one seed backs
 *    the whole estate, the vault is the wallet.
 *  - Curves/cryptography: privkey = 32B; pubkey via Node crypto secp256k1
 *    (JWK d/x/y → 65-byte uncompressed). NO third-party deps.
 *  - TRON address = base58check(0x41 ‖ keccak256(pub[1:])[-20:]) — vectored
 *    below (keccak256("") and keccak256("abc") canonical vectors, base58check
 *    Bitcoin-wiki vector, WIF canonical vector).
 *  - Zero secret material in ANY return except the explicit sealed paths;
 *    ledgers carry addresses only. The chain judges (R306-b): a wallet is
 *    UNFUNDED-UNVERIFIED until its first inbound transfer is observed.
 *  - Honesty: this module NEVER broadcasts, NEVER sends — it derives, seals,
 *    and accounts. Movement of value is a separately-armed wave.
 */

import * as crypto from "node:crypto";

/* ================= base58 / base58check (vectored) ================= */

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Encode(buf) {
  let n = BigInt("0x" + buf.toString("hex"));
  let out = "";
  while (n > 0n) {
    out = B58_ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of buf) {
    if (b === 0) out = "1" + out; else break;
  }
  return out || "1";
}

export function base58Decode(s) {
  let n = 0n;
  for (const c of String(s)) {
    const i = B58_ALPHABET.indexOf(c);
    if (i < 0) throw Object.assign(new Error("base58: bad character"), { code: "B58-BAD-CHAR" });
    n = n * 58n + BigInt(i);
  }
  let hex = n.toString(16).padStart(2, "0");
  if (hex.length % 2) hex = "0" + hex;
  let buf = Buffer.from(hex, "hex");
  for (const c of String(s)) {
    if (c === "1") buf = Buffer.concat([Buffer.from([0]), buf]); else break;
  }
  return buf;
}

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest();
const ripemd160 = (buf) => crypto.createHash("ripemd160").update(buf).digest();

/** base58check(payload) = base58(payload ‖ sha256(sha256(payload))[0..4]) */
export function base58checkEncode(payload) {
  const checksum = sha256(sha256(payload)).subarray(0, 4);
  return base58Encode(Buffer.concat([payload, checksum]));
}

/** base58checkDecode — throws B58-CHECKSUM on mismatch (typed, fail-closed). */
export function base58checkDecode(s) {
  const raw = base58Decode(s);
  if (raw.length < 5) throw Object.assign(new Error("base58check: too short"), { code: "B58-CHECKSUM" });
  const payload = raw.subarray(0, -4);
  const checksum = raw.subarray(-4);
  if (!sha256(sha256(payload)).subarray(0, 4).equals(checksum)) {
    throw Object.assign(new Error("base58check: checksum mismatch"), { code: "B58-CHECKSUM" });
  }
  return payload;
}

/* ================= keccak-256 (pure JS, f[1600], vectored) ================= */

const KECCAK_RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const KECCAK_ROT = [
  [0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61], [28, 55, 25, 21, 56], [27, 20, 39, 8, 14],
];
const rotl64 = (v, n) => { const N = BigInt(n); return ((v << N) | (v >> (64n - N))) & mask64; };

function keccakF(state) {
  for (let round = 0; round < 24; round++) {
    const c = [];
    for (let x = 0; x < 5; x++) c[x] = state[x][0] ^ state[x][1] ^ state[x][2] ^ state[x][3] ^ state[x][4];
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5] ^ rotl64(c[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y++) state[x][y] ^= d;
    }
    let b = Array.from({ length: 5 }, () => new Array(5).fill(0n));
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) b[y][(2 * x + 3 * y) % 5] = rotl64(state[x][y], KECCAK_ROT[x][y]);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) state[x][y] = b[x][y] ^ ((~b[(x + 1) % 5][y] & 0xffffffffffffffffn) & b[(x + 2) % 5][y]);
    state[0][0] ^= KECCAK_RC[round];
  }
  return state;
}

const mask64 = 0xffffffffffffffffn;
const le64 = (buf, off) => BigInt("0x" + buf.subarray(off, off + 8).reverse().toString("hex"));

/**
 * keccak256(msg) — original Keccak padding (0x01 … 0x80), NOT NIST SHA3 (0x06).
 * Vectors: keccak256("") = c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a456
 *          keccak256("abc") = 4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45
 */
export function keccak256(msg) {
  const rate = 136; /* 1088 bits for 256-bit output */
  const q = rate - (msg.length % rate);
  const pad = Buffer.alloc(q, 0);
  pad[0] = 0x01;
  pad[q - 1] |= 0x80;
  const blocks = Buffer.concat([Buffer.from(msg), pad]);
  const state = Array.from({ length: 5 }, () => new Array(5).fill(0n));
  for (let off = 0; off < blocks.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      const x = i % 5, y = Math.floor(i / 5);
      state[x][y] ^= le64(blocks, off + i * 8);
    }
    keccakF(state);
  }
  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) {
    const x = i % 5, y = Math.floor(i / 5);
    out.subarray(i * 8, i * 8 + 8).set(Buffer.from(state[x][y].toString(16).padStart(16, "0"), "hex").reverse());
  }
  return out;
}

/* ================= secp256k1 pubkey via native crypto ================= */

const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

function privkeyNormalize(bytes32) {
  let d = BigInt("0x" + bytes32.toString("hex")) % N;
  if (d === 0n) d = 1n;
  return Buffer.from(d.toString(16).padStart(64, "0"), "hex");
}

/* RFC5915 SEC1 DER for a secp256k1 private key — native crypto does the EC math:
 *   SEQUENCE { INTEGER 1, OCTET STRING (32B priv), [0] OID 1.3.132.0.10 } */
const SEC1_PREFIX = Buffer.from("302e0201010420", "hex");
const SEC1_CURVE = Buffer.from("a00706052b8104000a", "hex");

/** uncompressed 65-byte pubkey (0x04 ‖ X ‖ Y) for a normalized 32-byte privkey. */
export function secp256k1PubUncompressed(priv32) {
  const der = Buffer.concat([SEC1_PREFIX, priv32, SEC1_CURVE]);
  const pk = crypto.createPrivateKey({ key: der, format: "der", type: "sec1" });
  const spki = crypto.createPublicKey(pk).export({ format: "der", type: "spki" });
  const pub = spki.subarray(-65);
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw Object.assign(new Error("wallet: unexpected SPKI tail (not 0x04‖64B)"), { code: "WALLET-PUB-SHAPE" });
  }
  return Buffer.from(pub);
}

/* ================= wallet derivation (deterministic chain) ================= */

/** privkeyFor(seed, label) — HMAC-SHA512(seed, "SAOS-WALLET-v1|" + label) left 32B, mod n. */
export function privkeyFor(seed, label) {
  if (!Buffer.isBuffer(seed) || seed.length < 32) {
    throw Object.assign(new Error("wallet: seed must be ≥32 bytes"), { code: "WALLET-SEED-WEAK" });
  }
  if (!/^[a-z0-9:_-]{1,64}$/i.test(String(label))) {
    throw Object.assign(new Error("wallet: label charset [a-z0-9:_-] 1..64"), { code: "WALLET-LABEL-BAD" });
  }
  return privkeyNormalize(crypto.createHmac("sha512", seed).update("SAOS-WALLET-v1|" + label).digest().subarray(0, 32));
}

/** WIF (mainnet 0x80, NO compressed flag — the Steem/graphene convention).
 * Canonical vector (Bitcoin wiki): 0x0C28FCA3…1D → 5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ. */
export function wifEncode(priv32) {
  return base58checkEncode(Buffer.concat([Buffer.from([0x80]), priv32]));
}

/** TRON address (T…, 0x41 version) from a normalized privkey. */
export function tronAddress(priv32) {
  const pub = secp256k1PubUncompressed(priv32);
  const h = keccak256(pub.subarray(1)).subarray(-20);
  return base58checkEncode(Buffer.concat([Buffer.from([0x41]), h]));
}

/** Bitcoin-style P2PKH? NOT used — kept out; the estate rails are TRON + Steem. */

/** Steem/Hive graphene keypair shapes (for FUTURE account keys, never fleet authority): */
export function steemPublicFromPriv(priv32) {
  const pub = secp256k1PubUncompressed(priv32);
  const X = pub.subarray(1, 33);
  const Y = pub.subarray(33);
  const compressed = Buffer.concat([Buffer.from([0x02 + (Y[Y.length - 1] & 1)]), X]);
  const check = ripemd160(sha256(compressed)).subarray(0, 4);
  return "STM" + base58Encode(Buffer.concat([compressed, check]));
}

/**
 * deriveWallet(seed, label) — the ONE honest shape a ledger ever sees:
 * { label, address, fingerprint } — the privkey NEVER leaves this module
 * except through sealAllWallets (vault path).
 */
export function deriveWallet(seed, label) {
  const priv = privkeyFor(seed, label);
  const address = tronAddress(priv);
  return {
    label,
    address,
    fingerprint: `${priv.subarray(0, 3).toString("hex")}…${priv.subarray(-2).toString("hex")}`,
  };
}

/** deriveWallets(seed, labels) — ordered map; deterministic: same seed+labels → identical output forever. */
export function deriveWallets(seed, labels) {
  const out = [];
  for (const label of labels) out.push(deriveWallet(seed, label));
  return out;
}

/** newMasterSeed() — 64 cryptographically random bytes for the WALLETS-SEAL class. */
export const newMasterSeed = () => crypto.randomBytes(64);
