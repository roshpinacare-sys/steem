'use strict';
/**
 * src/lib/solvencyFederationAttestationBundleLedger411.js — ECOS V411
 * (Phase P299) — Attestation Bundle Ledger.
 *
 * Turns the V410 master-attestation bundle (which only tracks `lastBundle`)
 * into an append-only, hash-chained ledger so an auditor can prove which
 * V410 bundle was current at any historical point and that no bundle was
 * silently swapped. Each ledger entry stores the V410 bundle's
 * contentHash + signature and links to the previous entry via `prevHash`,
 * forming a tamper-evident chain rooted at GENESIS_HASH_411.
 *
 * Pure, deterministic. No new npm deps (R3). Sacred read-only (R1).
 * Identifiers end in 411 (R2).
 *
 * @version 411.0.0
 */

const crypto = require('crypto');

const ATTESTATION_BUNDLE_LEDGER_VERSION_411 = '411.0.0';
const GENESIS_HASH_411 = '0'.repeat(64);

const _sha411 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function _entryHash411(entry) {
  const payload = JSON.stringify({
    seq: entry.seq,
    ts: entry.ts,
    prevHash: entry.prevHash,
    bundleContentHash: entry.bundleContentHash,
    bundleSignature: entry.bundleSignature,
    bundledAt: entry.bundledAt,
  });
  return _sha411('attestation-bundle-ledger411|' + payload);
}

function createSolvencyFederationAttestationBundleLedger411(opts) {
  opts = opts || {};
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const maxEntries = Number.isFinite(opts.maxEntries)
    ? Math.max(16, opts.maxEntries | 0)
    : 4096;

  const entries = []; // append-only ring
  let nextSeq = 1;
  let headHash = GENESIS_HASH_411;
  let totalAppends = 0;
  const seenBundleHashes = new Set();

  function append411(attestationBundle410) {
    if (!attestationBundle410 || typeof attestationBundle410.getLastBundle410 !== 'function') {
      throw new Error('attestationBundle410 required');
    }
    const bundle = attestationBundle410.getLastBundle410();
    if (!bundle) {
      return { ok: false, reason: 'no_bundle_to_append_411' };
    }
    if (seenBundleHashes.has(bundle.contentHash)) {
      return { ok: false, reason: 'bundle_already_appended_411',
        bundleContentHash: bundle.contentHash };
    }
    const entry = {
      seq: nextSeq++,
      ts: now(),
      prevHash: headHash,
      bundleContentHash: bundle.contentHash,
      bundleSignature: bundle.signature,
      bundledAt: bundle.body && bundle.body.bundledAt,
      entryHash: null,
    };
    entry.entryHash = _entryHash411(entry);
    entries.push(entry);
    while (entries.length > maxEntries) entries.shift();
    headHash = entry.entryHash;
    seenBundleHashes.add(bundle.contentHash);
    totalAppends++;
    return { ok: true, entry: Object.assign({}, entry) };
  }

  function verifyChain411() {
    let prev = GENESIS_HASH_411;
    for (const e of entries) {
      if (e.prevHash !== prev) {
        return { valid: false, brokenAtSeq: e.seq, reason: 'prev_hash_mismatch_411' };
      }
      const expected = _entryHash411(e);
      if (expected !== e.entryHash) {
        return { valid: false, brokenAtSeq: e.seq, reason: 'entry_hash_mismatch_411' };
      }
      prev = e.entryHash;
    }
    return { valid: true, headHash, length: entries.length };
  }

  function list411(limit) {
    const n = Number.isFinite(limit) ? Math.max(1, limit | 0) : entries.length;
    return entries.slice(-n).map((e) => Object.assign({}, e));
  }

  function stats411() {
    return {
      entries: entries.length,
      nextSeq,
      totalAppends,
      headHash,
      hasEntries: entries.length > 0,
    };
  }

  return { append411, verifyChain411, list411, stats411,
    GENESIS_HASH_411 };
}

module.exports = {
  ATTESTATION_BUNDLE_LEDGER_VERSION_411,
  GENESIS_HASH_411,
  createSolvencyFederationAttestationBundleLedger411,
};
