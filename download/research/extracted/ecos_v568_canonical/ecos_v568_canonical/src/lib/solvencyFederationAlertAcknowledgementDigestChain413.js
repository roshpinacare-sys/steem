'use strict';
/**
 * src/lib/solvencyFederationAlertAcknowledgementDigestChain413.js — ECOS V413 (Phase P301) — Alert Acknowledgement Digest Chain.
 *
 * Turns the ephemeral V412 digest stream into an append-only,
 * hash-chained ledger so an auditor can prove which V412 digest
 * was current at any historical point and that no digest was
 * silently swapped. Each entry stores the V412 source contentHash +
 * signature and links to the previous entry via prevHash, forming a
 * tamper-evident chain rooted at GENESIS_HASH_413.
 *
 * Pure, deterministic. No new npm deps (R3). Sacred read-only (R1).
 * Identifiers end in 413 (R2).
 *
 * @version 413.0.0
 */

const crypto = require('crypto');

const ALERT_ACKNOWLEDGEMENT_DIGEST_CHAIN_VERSION_413 = '413.0.0';
const GENESIS_HASH_413 = '0'.repeat(64);

const _sha413 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function _entryHash413(entry) {
  const payload = JSON.stringify({
    seq: entry.seq,
    ts: entry.ts,
    prevHash: entry.prevHash,
    sourceContentHash: entry.sourceContentHash,
    sourceSignature: entry.sourceSignature,
    sourceSeq412: entry.sourceSeq412,
  });
  return _sha413('solvencyFederationAlertAcknowledgementDigestChain413|' + payload);
}

function createSolvencyFederationAlertAcknowledgementDigestChain413(opts) {
  opts = opts || {};
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const maxEntries = Number.isFinite(opts.maxEntries)
    ? Math.max(16, opts.maxEntries | 0)
    : 4096;

  const entries = [];
  let nextSeq = 1;
  let headHash = GENESIS_HASH_413;
  let totalAppends = 0;
  const seenSourceHashes = new Set();

  function append413(alertAckDigest412) {
    if (!alertAckDigest412 || typeof alertAckDigest412.getLastDigest412 !== 'function') {
      throw new Error('alertAckDigest412 required');
    }
    const src = alertAckDigest412.getLastDigest412();
    if (!src) {
      return { ok: false, reason: 'no_digest_to_append_413' };
    }
    if (seenSourceHashes.has(src.contentHash)) {
      return { ok: false, reason: 'digest_already_appended_413',
        sourceContentHash: src.contentHash };
    }
    const entry = {
      seq: nextSeq++,
      ts: now(),
      prevHash: headHash,
      sourceContentHash: src.contentHash,
      sourceSignature: src.signature,
      sourceSeq412: src.digestSeq412,
      digestSeq412: src.digestSeq412, acksHash: src.acksHash, ackCount: src.ackCount, ackedCount: src.ackedCount, totalAcks: src.totalAcks,
      entryHash: null,
    };
    entry.entryHash = _entryHash413(entry);
    entries.push(entry);
    while (entries.length > maxEntries) entries.shift();
    headHash = entry.entryHash;
    seenSourceHashes.add(src.contentHash);
    totalAppends++;
    return { ok: true, entry: Object.assign({}, entry) };
  }

  function verifyChain413() {
    let prev = GENESIS_HASH_413;
    for (const e of entries) {
      if (e.prevHash !== prev) {
        return { valid: false, brokenAtSeq: e.seq, reason: 'prev_hash_mismatch_413' };
      }
      const expected = _entryHash413(e);
      if (expected !== e.entryHash) {
        return { valid: false, brokenAtSeq: e.seq, reason: 'entry_hash_mismatch_413' };
      }
      prev = e.entryHash;
    }
    return { valid: true, headHash, length: entries.length };
  }

  function list413(limit) {
    const n = Number.isFinite(limit) ? Math.max(1, limit | 0) : entries.length;
    return entries.slice(-n).map((e) => Object.assign({}, e));
  }

  function stats413() {
    return {
      entries: entries.length,
      nextSeq,
      totalAppends,
      headHash,
      hasEntries: entries.length > 0,
    };
  }

  return { append413, verifyChain413, list413, stats413, GENESIS_HASH_413 };
}

module.exports = {
  ALERT_ACKNOWLEDGEMENT_DIGEST_CHAIN_VERSION_413,
  GENESIS_HASH_413,
  createSolvencyFederationAlertAcknowledgementDigestChain413,
};
