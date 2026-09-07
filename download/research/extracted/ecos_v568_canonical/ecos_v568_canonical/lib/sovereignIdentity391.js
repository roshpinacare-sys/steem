'use strict';
/**
 * src/lib/sovereignIdentity391.js — ECOS V391 (Phase P279) — Sovereign Identity
 *
 * THE MISSING FOUNDATION (found by audit): ECOS has reputation, sybilGuard, credit,
 * receipts — but identities were not cryptographically OWNED. Anyone who could write
 * an account id could act as it. Before a real-money pilot, that is the deepest hole.
 *
 * This ports the principles of the owner's VOID-Zero design into pure JS using only
 * Node's built-in crypto (ed25519 + sha256) — NO Rust, NO new npm deps (R6):
 *   • Key-derived id   — id = sha256(pubkey)[0:16]  → identity cannot be spoofed.
 *   • Strict signature — sig binds (semanticRoot ‖ nonce ‖ id) → no context transplant.
 *   • Nonce sequencing — each claim must be lastNonce+1 → no replay.
 *   • PoW on creation  — sha256(id‖nonce) leading-zero bytes → raises sybil cost.
 *   • Tombstone        — revoked ids can never be re-registered → no zombies.
 * Every ACCEPTED claim is appended to the sacred audit log, so identity actions are
 * themselves tamper-evident and covered by the V360/V372 integrity proofs. This gives
 * reputation/credit/receipts a real cryptographic subject: "we know who acted."
 *
 * @version 391.0.0
 */

const crypto = require('crypto');

const SI_VERSION_391 = '391.0.0';
const POW_DIFFICULTY_391 = 1;            // leading zero BYTES of sha256(id‖nonce); ~256 attempts
const MAX_KEY_LEN_391 = 64;
const MAX_VALUE_LEN_391 = 512;

class IdentityError391 extends Error {
  constructor(msg, code) { super(msg); this.name = 'IdentityError391'; this.code = code || 'IDENTITY_ERROR'; this.statusCode = 403; }
}

const _sha256 = (buf) => crypto.createHash('sha256').update(buf).digest();
function _rawPubFromKeyObject391(pub) { return Buffer.from(pub.export({ format: 'jwk' }).x, 'base64url'); }
function _keyObjectFromRaw391(rawHexOrBuf) {
  const raw = Buffer.isBuffer(rawHexOrBuf) ? rawHexOrBuf : Buffer.from(rawHexOrBuf, 'hex');
  return crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' });
}

/** id = first 16 bytes of sha256(rawPubkey), hex (anti-spoofing: id is bound to the key). */
function deriveIdentityId391(rawPubkey) {
  const raw = Buffer.isBuffer(rawPubkey) ? rawPubkey : Buffer.from(rawPubkey, 'hex');
  return _sha256(raw).toString('hex').slice(0, 32); // 16 bytes
}

/** semanticRoot = sha256(canonical claim payload). */
function semanticRoot391(payloadObj) {
  return _sha256(Buffer.from(_canon391(payloadObj), 'utf8')).toString('hex');
}
function _canon391(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(_canon391).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + _canon391(v[k])).join(',') + '}';
}

/** Canonical signing material: semanticRoot(hex) ‖ nonce(BE u64) ‖ id(hex). */
function signingMaterial391(semanticRootHex, nonce, idHex) {
  const n = Buffer.alloc(8); n.writeBigUInt64BE(BigInt(nonce));
  return Buffer.concat([Buffer.from(semanticRootHex, 'hex'), n, Buffer.from(idHex, 'hex')]);
}

function verifyPow391(idHex, nonce, difficulty = POW_DIFFICULTY_391) {
  const n = Buffer.alloc(8); n.writeBigUInt64BE(BigInt(nonce));
  const d = _sha256(Buffer.concat([Buffer.from(idHex, 'hex'), n]));
  for (let i = 0; i < difficulty; i++) if (d[i] !== 0) return false;
  return true;
}
function minePow391(idHex, difficulty = POW_DIFFICULTY_391) {
  for (let nonce = 0; nonce < 1e7; nonce++) if (verifyPow391(idHex, nonce, difficulty)) return nonce;
  throw new IdentityError391('PoW not found', 'POW_EXHAUSTED');
}

/**
 * The sovereign-identity state machine. Stateless geometry (verify) + sovereign
 * state transitions, mirroring VOID-Zero's Kernel/VM split.
 */
class SovereignIdentityVM391 {
  constructor(opts = {}) {
    this.registry = new Map();   // id -> { ownerPubkey(hex), lastNonce } | 'REVOKED'
    this.difficulty = opts.difficulty || POW_DIFFICULTY_391;
    this.audit = typeof opts.audit === 'function' ? opts.audit : null;
  }

  /**
   * @param {{ id, nonce, action }} claim   action = {type:'create',powNonce}|{type:'update',key,value}|{type:'revoke'}
   * @param {Buffer|string} signature       64-byte ed25519 sig (Buffer or hex)
   * @param {Buffer|string} rawPubkey       32-byte ed25519 public key (only needed for create; else resolved)
   */
  execute(claim, signature, rawPubkey) {
    if (!claim || typeof claim !== 'object' || !claim.id || claim.nonce == null || !claim.action) {
      throw new IdentityError391('malformed claim', 'BAD_CLAIM');
    }
    const sig = Buffer.isBuffer(signature) ? signature : Buffer.from(signature, 'hex');
    if (sig.length !== 64) throw new IdentityError391('signature must be 64 bytes', 'BAD_SIG');

    // 1. semantic integrity: the signed root must match the claim payload (anti-transplant)
    const sRoot = semanticRoot391({ id: claim.id, nonce: claim.nonce, action: claim.action });

    // 2. resolve authority (anti-spoofing + PoW for create; revoked/active checks)
    const ownerPubHex = this._resolveAuthority(claim, rawPubkey);

    // 3. strict signature verification — binds sRoot ‖ nonce ‖ id to the owning key
    const msg = signingMaterial391(sRoot, claim.nonce, claim.id);
    const ok = crypto.verify(null, msg, _keyObjectFromRaw391(ownerPubHex), sig);
    if (!ok) throw new IdentityError391('signature verification failed', 'BAD_SIGNATURE');

    // 4. state transition
    this._apply(claim, ownerPubHex);

    if (this.audit) { try { this.audit('identity.' + claim.action.type, { id: claim.id, nonce: claim.nonce, semanticRoot: sRoot }); } catch (_) {} }
    return { ok: true, id: claim.id, nonce: claim.nonce, action: claim.action.type, semanticRoot: sRoot };
  }

  _resolveAuthority(claim, rawPubkey) {
    const slot = this.registry.get(claim.id);
    if (!slot && claim.action.type === 'create') {
      if (!rawPubkey) throw new IdentityError391('create requires rawPubkey', 'NO_PUBKEY');
      const rawHex = (Buffer.isBuffer(rawPubkey) ? rawPubkey : Buffer.from(rawPubkey, 'hex')).toString('hex');
      if (deriveIdentityId391(rawHex) !== claim.id) throw new IdentityError391('spoofing: id not derived from pubkey', 'SPOOF');
      if (!verifyPow391(claim.id, claim.action.powNonce, this.difficulty)) throw new IdentityError391('insufficient PoW', 'WEAK_POW');
      return rawHex;
    }
    if (slot === 'REVOKED') throw new IdentityError391('identity is revoked', 'REVOKED');
    if (slot && typeof slot === 'object') return slot.ownerPubkey;
    throw new IdentityError391('no valid authority for action', 'NO_AUTHORITY');
  }

  _apply(claim, ownerPubHex) {
    const id = claim.id;
    if (claim.action.type === 'create') {
      if (claim.nonce !== 0) throw new IdentityError391('genesis nonce must be 0', 'BAD_NONCE');
      if (this.registry.has(id)) throw new IdentityError391('id slot occupied (active or tombstoned)', 'OCCUPIED');
      this.registry.set(id, { ownerPubkey: ownerPubHex, lastNonce: 0, claims: {} });
    } else if (claim.action.type === 'update') {
      const { key, value } = claim.action;
      if (String(key).length > MAX_KEY_LEN_391 || String(value).length > MAX_VALUE_LEN_391) throw new IdentityError391('semantic limit exceeded', 'TOO_LARGE');
      const s = this.registry.get(id);
      if (s === 'REVOKED') throw new IdentityError391('identity is revoked', 'REVOKED');
      if (!s) throw new IdentityError391('identity not found', 'NOT_FOUND');
      if (claim.nonce !== s.lastNonce + 1) throw new IdentityError391(`nonce gap: expected ${s.lastNonce + 1}, got ${claim.nonce}`, 'NONCE_GAP');
      s.lastNonce = claim.nonce; s.claims[key] = value;
    } else if (claim.action.type === 'revoke') {
      const s = this.registry.get(id);
      if (s === 'REVOKED') throw new IdentityError391('already revoked', 'ALREADY_REVOKED');
      if (!s) throw new IdentityError391('identity not found', 'NOT_FOUND');
      this.registry.set(id, 'REVOKED');
    } else {
      throw new IdentityError391('unknown action', 'BAD_ACTION');
    }
  }

  status(id) {
    const s = this.registry.get(id);
    if (!s) return { exists: false };
    if (s === 'REVOKED') return { exists: true, revoked: true };
    return { exists: true, revoked: false, lastNonce: s.lastNonce, ownerPubkey: s.ownerPubkey, claims: s.claims };
  }
  stats() {
    let active = 0, revoked = 0;
    for (const s of this.registry.values()) (s === 'REVOKED') ? revoked++ : active++;
    return { total: this.registry.size, active, revoked, difficulty: this.difficulty };
  }
}

/** Convenience: generate an ed25519 keypair and its derived id (for clients/tests). */
function generateIdentity391() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const rawPub = _rawPubFromKeyObject391(publicKey);
  return { privateKey, publicKey, rawPubkeyHex: rawPub.toString('hex'), id: deriveIdentityId391(rawPub) };
}
/** Sign a claim with a private KeyObject (client-side helper). */
function signClaim391(claim, privateKey) {
  const sRoot = semanticRoot391({ id: claim.id, nonce: claim.nonce, action: claim.action });
  const msg = signingMaterial391(sRoot, claim.nonce, claim.id);
  return crypto.sign(null, msg, privateKey).toString('hex');
}

let _defaultVM391 = null;
function defaultSovereignIdentityVM391() { if (!_defaultVM391) _defaultVM391 = new SovereignIdentityVM391(); return _defaultVM391; }

module.exports = {
  SI_VERSION_391, POW_DIFFICULTY_391, IdentityError391,
  deriveIdentityId391, semanticRoot391, signingMaterial391, verifyPow391, minePow391,
  SovereignIdentityVM391, defaultSovereignIdentityVM391,
  generateIdentity391, signClaim391,
};
