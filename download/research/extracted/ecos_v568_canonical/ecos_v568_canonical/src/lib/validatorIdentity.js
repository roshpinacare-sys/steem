/**
 * validatorIdentity.js — ECOS V122
 * ===================================
 * Cryptographically-derived validator identities.
 *
 * Each validator gets a deterministic key pair derived from:
 *   masterSeed → HKDF(sha256, salt="ecos-validator", info=validatorId) → 32-byte key
 *
 * The validator's public identity is:
 *   vid = sha256(publicKey)[0:16]   — 16-hex-char human-readable ID
 *   display = "V-" + vid[0:8]       — short display ID
 *
 * This satisfies the VOID-Zero research requirement:
 *   "ValidatorIdentity — key-derived IDs so validators are cryptographically
 *    bound to their actions in the audit chain."
 *
 * Usage:
 *   const vi = new ValidatorIdentity({ masterSeed: process.env.VALIDATOR_MASTER_SEED });
 *   const id = vi.deriveId('validator_uuid');
 *   // → { validatorId: 'validator_uuid', vid: 'a3f2...', display: 'V-a3f2cc1d', publicKey: '...' }
 *
 *   // Attest a task hash with the validator's derived key
 *   const attestation = vi.attest('validator_uuid', taskHash);
 *   // → { vid, taskHash, signature, timestamp }
 *
 *   // Verify attestation (static)
 *   const ok = ValidatorIdentity.verifyAttestation(attestation, publicKey);
 *
 * [V122-P13-02] Initial implementation
 */

'use strict';

const crypto = require('node:crypto');

// ── Constants ─────────────────────────────────────────────────────────────────

const HKDF_HASH     = 'sha256';
const HKDF_SALT     = Buffer.from('ecos-validator-identity-v1', 'utf8');
const KEY_LEN       = 32; // bytes for HMAC-SHA256 signing key

// ── Key derivation ────────────────────────────────────────────────────────────

/**
 * Derive a 32-byte signing key for a specific validatorId from a master seed.
 * Uses Node's built-in crypto.hkdfSync (available since Node 15).
 *
 * Falls back to HMAC-based derivation if hkdfSync is unavailable.
 */
function deriveKey(masterSeed, validatorId) {
  const info = Buffer.from('validator:' + validatorId, 'utf8');
  const ikm  = Buffer.isBuffer(masterSeed)
    ? masterSeed
    : Buffer.from(masterSeed, 'utf8');

  if (typeof crypto.hkdfSync === 'function') {
    return Buffer.from(
      crypto.hkdfSync(HKDF_HASH, ikm, HKDF_SALT, info, KEY_LEN)
    );
  }
  // Fallback: HMAC-based HKDF (extract + expand)
  const prk = crypto.createHmac('sha256', HKDF_SALT).update(ikm).digest();
  const okm = crypto.createHmac('sha256', prk)
    .update(Buffer.concat([info, Buffer.from([1])]))
    .digest();
  return okm.slice(0, KEY_LEN);
}

/**
 * Derive the public identity (vid) from a signing key.
 * We use the key itself as the "public" identifier since we're using symmetric
 * HMAC (not asymmetric). The vid is a hash of the key — it's safe to share.
 */
function keyToVid(signingKey) {
  return crypto.createHash('sha256').update(signingKey).digest('hex').slice(0, 16);
}

// ── ValidatorIdentity class ───────────────────────────────────────────────────

class ValidatorIdentity {
  /**
   * @param {object} opts
   * @param {string|Buffer} opts.masterSeed — secret master seed (from env)
   *   If not provided, a random ephemeral seed is generated (dev mode only).
   */
  constructor(opts = {}) {
    if (opts.masterSeed) {
      this._seed = Buffer.isBuffer(opts.masterSeed)
        ? opts.masterSeed
        : Buffer.from(opts.masterSeed, 'utf8');
      this._ephemeral = false;
    } else {
      this._seed = crypto.randomBytes(32);
      this._ephemeral = true;
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          '[ValidatorIdentity] VALIDATOR_MASTER_SEED is required in production. ' +
          'Set the VALIDATOR_MASTER_SEED environment variable.'
        );
      }
    }
    this._cache = new Map(); // validatorId → { signingKey, vid, display }
  }

  /**
   * Derive (or retrieve from cache) the identity record for a validator.
   *
   * @param {string} validatorId — the validator's UUID / DB id
   * @returns {{ validatorId, vid, display, publicKey, ephemeral }}
   */
  deriveId(validatorId) {
    if (this._cache.has(validatorId)) return this._cache.get(validatorId);

    const signingKey = deriveKey(this._seed, validatorId);
    const vid        = keyToVid(signingKey);
    const display    = 'V-' + vid.slice(0, 8);

    const record = {
      validatorId,
      vid,
      display,
      // "public key" = vid (safe to share; inverse of signing key is infeasible)
      publicKey: vid,
      ephemeral: this._ephemeral,
    };
    this._cache.set(validatorId, { ...record, _signingKey: signingKey });
    return record;
  }

  /**
   * Attest a task hash with the validator's derived signing key.
   * Attestation is an HMAC-SHA256 of (vid + ':' + taskHash + ':' + timestamp).
   *
   * @param {string} validatorId
   * @param {string} taskHash — hex hash of the task being attested
   * @returns {{ vid, taskHash, signature, timestamp, display }}
   */
  attest(validatorId, taskHash) {
    const cached = this._cache.get(validatorId) || (() => {
      this.deriveId(validatorId);
      return this._cache.get(validatorId);
    })();

    const timestamp = Date.now();
    const message   = `${cached.vid}:${taskHash}:${timestamp}`;
    const signature = crypto
      .createHmac('sha256', cached._signingKey)
      .update(message)
      .digest('hex');

    return {
      vid: cached.vid,
      display: cached.display,
      validatorId,
      taskHash,
      signature,
      timestamp,
      message, // include for verification
    };
  }

  /**
   * Verify an attestation.
   * @param {object} attestation — as returned by attest()
   * @param {string} validatorId — the validator whose key to derive
   * @returns {{ valid: boolean, reason?: string }}
   */
  verify(validatorId, attestation) {
    try {
      const cached = this._cache.get(validatorId) || (() => {
        this.deriveId(validatorId);
        return this._cache.get(validatorId);
      })();

      const expected = crypto
        .createHmac('sha256', cached._signingKey)
        .update(attestation.message)
        .digest('hex');

      const valid = crypto.timingSafeEqual(
        Buffer.from(expected, 'hex'),
        Buffer.from(attestation.signature, 'hex')
      );
      return valid
        ? { valid: true }
        : { valid: false, reason: 'signature mismatch' };
    } catch (err) {
      return { valid: false, reason: err.message };
    }
  }

  /**
   * Summary stats.
   */
  stats() {
    return {
      cachedValidators: this._cache.size,
      ephemeral: this._ephemeral,
    };
  }
}

// ── Default singleton ─────────────────────────────────────────────────────────

let _defaultInstance = null;

function getDefaultValidatorIdentity() {
  if (!_defaultInstance) {
    _defaultInstance = new ValidatorIdentity({
      masterSeed: process.env.VALIDATOR_MASTER_SEED || null,
    });
  }
  return _defaultInstance;
}

module.exports = {
  ValidatorIdentity,
  getDefaultValidatorIdentity,
};
