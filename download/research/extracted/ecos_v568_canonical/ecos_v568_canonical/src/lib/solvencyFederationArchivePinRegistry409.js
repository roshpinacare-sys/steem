'use strict';
/**
 * src/lib/solvencyFederationArchivePinRegistry409.js — ECOS V409 (Phase P297) —
 * Federation Archive Digest Pin Registry.
 *
 * Maintains a chained-hash registry of pinned V408 archive digests so
 * an auditor can verify continuity of the consensus archive across
 * time: each pin references the previous pin's chain hash, so any
 * silent rewrite of past pins is detectable.
 *
 * Pure, deterministic. No new npm deps (R3). Sacred read-only (R1).
 * Identifiers end in 409 (R2).
 *
 * @version 409.0.0
 */

const crypto = require('crypto');

const ARCHIVE_PIN_REGISTRY_VERSION_409 = '409.0.0';
const _sha409 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const _GENESIS_409 = _sha409('archive-pin-registry409|genesis');

function createSolvencyFederationArchivePinRegistry409(opts) {
  opts = opts || {};
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const maxPins = Number.isFinite(opts.maxPins)
    ? Math.max(16, opts.maxPins | 0)
    : 4096;

  const pins = []; // { seq, ts, digest, count, headSeq, prevHash, chainHash }
  let nextSeq = 1;
  let lastChainHash = _GENESIS_409;

  function pin409(digest408) {
    if (!digest408 || typeof digest408.getDigest408 !== 'function') {
      throw new Error('digest408 required');
    }
    const d = digest408.getDigest408();
    if (!d || typeof d.digest !== 'string') {
      throw new Error('digest408.getDigest408() returned no digest');
    }
    const ts = now();
    const seq = nextSeq++;
    const prevHash = lastChainHash;
    const chainHash = _sha409(
      'archive-pin-registry409|' + seq + '|' + prevHash +
      '|' + d.digest + '|' + (d.count | 0) + '|' + (d.headSeq | 0) + '|' + ts
    );
    const rec = {
      seq, ts,
      digest: d.digest,
      count: d.count | 0,
      headSeq: d.headSeq | 0,
      prevHash, chainHash,
    };
    pins.push(rec);
    while (pins.length > maxPins) pins.shift();
    lastChainHash = chainHash;
    return { ok: true, pin: rec };
  }

  function list409(limit) {
    const n = Number.isFinite(limit) ? Math.max(1, limit | 0) : pins.length;
    return pins.slice(-n).map((r) => Object.assign({}, r));
  }

  function verifyChain409() {
    let prev = _GENESIS_409;
    for (const r of pins) {
      if (r.prevHash !== prev) {
        return { valid: false, brokenAtSeq: r.seq, reason: 'prev_hash_mismatch_409' };
      }
      const expected = _sha409(
        'archive-pin-registry409|' + r.seq + '|' + r.prevHash +
        '|' + r.digest + '|' + r.count + '|' + r.headSeq + '|' + r.ts
      );
      if (expected !== r.chainHash) {
        return { valid: false, brokenAtSeq: r.seq, reason: 'chain_hash_mismatch_409' };
      }
      prev = r.chainHash;
    }
    return { valid: true, length: pins.length, head: prev };
  }

  function findByDigest409(digest) {
    if (typeof digest !== 'string') return null;
    for (let i = pins.length - 1; i >= 0; i--) {
      if (pins[i].digest === digest) return Object.assign({}, pins[i]);
    }
    return null;
  }

  function stats409() {
    return {
      pins: pins.length,
      nextSeq,
      head: lastChainHash,
      lastDigest: pins.length ? pins[pins.length - 1].digest : null,
    };
  }

  return { pin409, list409, verifyChain409, findByDigest409, stats409 };
}

module.exports = {
  ARCHIVE_PIN_REGISTRY_VERSION_409,
  createSolvencyFederationArchivePinRegistry409,
};
