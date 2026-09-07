'use strict';
/**
 * src/lib/solvencyFederationArchiveDigest408.js — ECOS V408 (Phase P296) —
 * Federation Archive Rolling Digest.
 *
 * Computes a deterministic rolling chain digest over the V407 consensus
 * snapshot archive (chained sha256 of {seq | snapshotHash | signature}) so
 * an offline auditor can pin a single short value and detect any tampering
 * or reordering across the entire archive — without re-verifying every
 * HMAC individually.
 *
 * Pure, deterministic. No new npm deps (R3). Sacred read-only (R1).
 * Identifiers end in 408 (R2).
 *
 * @version 408.0.0
 */

const crypto = require('crypto');

const ARCHIVE_DIGEST_VERSION_408 = '408.0.0';
const _sha408 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const GENESIS_408 = _sha408('archive-digest408|genesis');

function _digestForEntries(entries) {
  let acc = GENESIS_408;
  for (const e of entries) {
    acc = _sha408('archive-digest408|' + e.seq + '|' + e.snapshotHash + '|' + e.signature + '|' + acc);
  }
  return acc;
}

function createSolvencyFederationArchiveDigest408(opts) {
  opts = opts || {};
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();

  let lastDigest = GENESIS_408;
  let lastCount = 0;
  let lastComputedAt = 0;
  let lastHeadSeq = 0;

  function recompute408(archive407) {
    if (!archive407 || typeof archive407.listArchive408 !== 'function' &&
                       typeof archive407.listArchive407 !== 'function') {
      throw new Error('archive407 required');
    }
    const list = (archive407.listArchive407 || archive407.listArchive408).call(archive407);
    const sorted = list.slice().sort((a, b) => a.seq - b.seq);
    const digest = _digestForEntries(sorted);
    lastDigest = digest;
    lastCount = sorted.length;
    lastHeadSeq = sorted.length ? sorted[sorted.length - 1].seq : 0;
    lastComputedAt = now();
    return { ok: true, digest, count: lastCount, headSeq: lastHeadSeq, computedAt: lastComputedAt };
  }

  function getDigest408() {
    return { digest: lastDigest, count: lastCount, headSeq: lastHeadSeq, computedAt: lastComputedAt };
  }

  function verifyAgainst408(archive407, expectedDigest) {
    if (!expectedDigest || typeof expectedDigest !== 'string') {
      return { valid: false, reason: 'expectedDigest required' };
    }
    const list = (archive407.listArchive407 || archive407.listArchive408).call(archive407);
    const sorted = list.slice().sort((a, b) => a.seq - b.seq);
    const digest = _digestForEntries(sorted);
    return { valid: digest === expectedDigest, digest, expectedDigest, count: sorted.length };
  }

  function stats408() {
    return { lastDigest, lastCount, lastHeadSeq, lastComputedAt };
  }

  return { recompute408, getDigest408, verifyAgainst408, stats408 };
}

module.exports = {
  ARCHIVE_DIGEST_VERSION_408,
  GENESIS_408,
  createSolvencyFederationArchiveDigest408,
};
