#!/usr/bin/env node
/**
 * identity.cjs — the crypto acceleration nucleus: ONE key, MANY networks.
 *
 * The vault holds a single secp256k1 WIF. This module derives every network
 * identity that secret mathematically rules:
 *   Steem   — compressed pubkey (STM…)   [proven on-chain]
 *   Hive    — same derivation, same keys [proven on-chain, 2018 account]
 *   EVM     — keccak256(uncompressed pubkey) → EIP-55 address
 *
 * Only PUBLIC derived data ever leaves this module — never the WIF itself.
 *
 * Usage: node identity.cjs        → prints JSON {steemPub, evmAddress}
 */
const crypto = require('crypto');
const ecurve = require('ecurve');
const BigInteger = require('bigi');
const { keccak256 } = require('js-sha3');
const steem = require('steem');

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Decode(str) {
  let num = BigInteger.ZERO;
  for (const ch of str) {
    const idx = B58_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('bad base58 char');
    num = num.multiply(BigInteger.valueOf(58)).add(BigInteger.valueOf(idx));
  }
  let hex = num.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  let bytes = Buffer.from(hex, 'hex');
  // leading '1' chars = leading zero bytes
  let pad = 0;
  for (const ch of str) {
    if (ch === '1') pad++;
    else break;
  }
  bytes = Buffer.concat([Buffer.alloc(pad), bytes]);
  return bytes;
}

function wifToScalar(wif) {
  const raw = base58Decode(wif);
  const body = raw.subarray(0, raw.length - 4); // strip checksum (0x80+key32[+0x01])
  const checksum = raw.subarray(raw.length - 4);
  const expect = crypto.createHash('sha256').update(crypto.createHash('sha256').update(body).digest()).digest().subarray(0, 4);
  if (!checksum.equals(expect)) throw new Error('WIF checksum mismatch');
  if (body[0] !== 0x80) throw new Error('not a mainnet WIF prefix');
  const compressed = body.length === 34 && body[33] === 0x01;
  return { d: BigInteger.fromBuffer(body.subarray(1, 33)), compressed };
}

function toChecksumAddress(hexLower) {
  const hash = keccak256(hexLower);
  let out = '0x';
  for (let i = 0; i < 40; i++) {
    out += parseInt(hash[i], 16) >= 8 ? hexLower[i].toUpperCase() : hexLower[i];
  }
  return out;
}

/** EIP-191 personal_sign hash: keccak256("\x19Ethereum Signed Message:\n" + len + msg) */
function eip191Hash(msg) {
  const msgBuf = Buffer.isBuffer(msg) ? msg : Buffer.from(String(msg), 'utf8');
  const prefix = Buffer.from('\x19Ethereum Signed Message:\n' + msgBuf.length, 'utf8');
  return Buffer.from(keccak256(Buffer.concat([prefix, msgBuf])), 'hex');
}

const SECP = ecurve.getCurveByName('secp256k1');

/**
 * ECDSA sign, Ethereum-compatible (low-s). Returns {r,s,recid} as BigInteger.
 * recid bit0 = R.y odd · bit1 = R.x ≥ N (standard ECDSA recovery param).
 */
function ecdsaSignLowS(h, dBig) {
  const N = SECP.n;
  const hB = h instanceof BigInteger ? h : BigInteger.fromBuffer(h);
  for (let tries = 0; tries < 64; tries++) {
    const k = BigInteger.fromBuffer(crypto.randomBytes(32)).mod(N);
    if (k.signum() === 0) continue;
    const R = SECP.G.multiply(k);
    const r = R.affineX.mod(N);
    if (r.signum() === 0) continue;
    let s = k.modInverse(N).multiply(hB.add(r.multiply(dBig))).mod(N);
    if (s.signum() === 0) continue;
    let recid = (R.affineY.testBit(0) ? 1 : 0) | (R.affineX.compareTo(N) >= 0 ? 2 : 0);
    if (s.compareTo(N.shiftRight(1)) > 0) {
      s = N.subtract(s);
      recid ^= 1;
    }
    return { r, s, recid };
  }
  throw new Error('ecdsa sign failed after 64 tries');
}

/** ECDSA public-point recovery (secp256k1, p ≡ 3 mod 4). Returns ecurve.Point. */
function ecdsaRecover(h, rBig, sBig, recid) {
  const N = SECP.n;
  const hB = h instanceof BigInteger ? h : BigInteger.fromBuffer(h);
  const x = rBig.add(N.multiply(BigInteger.valueOf(recid >> 1)));
  if (x.compareTo(SECP.p) >= 0) return null;
  const alpha = x.multiply(x).multiply(x).add(SECP.a.multiply(x)).add(SECP.b).mod(SECP.p);
  let beta = alpha.modPow(SECP.p.add(BigInteger.ONE).divide(BigInteger.valueOf(4)), SECP.p);
  if (beta.testBit(0) !== ((recid & 1) === 1)) beta = SECP.p.subtract(beta);
  const R = new ecurve.Point(SECP, x, beta, BigInteger.ONE);
  const rInv = rBig.modInverse(N);
  const hNeg = N.subtract(hB.mod(N)).mod(N);
  return R.multiply(sBig).add(SECP.G.multiply(hNeg)).multiply(rInv);
}

/** 65-byte Ethereum signature: r(32) || s(32) || v(27+recid), hex with 0x. */
function sigToEvmHex(sig) {
  return '0x' + Buffer.concat([sig.r.toBuffer(32), sig.s.toBuffer(32), Buffer.from([27 + sig.recid])]).toString('hex');
}

/** Parse 0x-hex 65-byte signature → {r,s,recid} as BigInteger. */
function sigFromEvmHex(hex) {
  const raw = String(hex || '').replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{130}$/.test(raw)) throw new Error('bad evm sig length');
  const buf = Buffer.from(raw, 'hex');
  const recid = buf[64] >= 27 ? buf[64] - 27 : buf[64];
  if (recid < 0 || recid > 3) throw new Error('bad recovery id');
  return { r: BigInteger.fromBuffer(buf.subarray(0, 32)), s: BigInteger.fromBuffer(buf.subarray(32, 64)), recid };
}

function deriveIdentities(wif) {
  const { d } = wifToScalar(wif);
  const curve = ecurve.getCurveByName('secp256k1');
  const Q = curve.G.multiply(d);

  // Steem/Hive compressed pubkey (sanity — must match wifToPublic + on-chain)
  const steemPub = steem.auth.wifToPublic(wif);

  // EVM: keccak256(X || Y) — uncompressed public key encoding, skip 0x04 prefix
  const enc = Q.getEncoded(false); // 65 bytes: 0x04 || X(32) || Y(32)
  const ethPub = Buffer.from(enc.subarray(1)); // 64 bytes
  const evmAddress = toChecksumAddress(keccak256(ethPub).slice(-40));

  return { steemPub, evmAddress };
}

module.exports = {
  deriveIdentities,
  base58Decode,
  wifToScalar,
  toChecksumAddress,
  eip191Hash,
  ecdsaSignLowS,
  ecdsaRecover,
  sigToEvmHex,
  sigFromEvmHex,
  SECP,
};

if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '.env');
  const env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const m = env.match(/POSTING_WIF=(.+)/);
  if (!m) {
    console.error('no POSTING_WIF in vault');
    process.exit(1);
  }
  try {
    const id = deriveIdentities(m[1].trim());
    console.log(JSON.stringify(id, null, 2));
  } catch (e) {
    console.error('identity derivation failed:', e.message);
    process.exit(1);
  }
}
