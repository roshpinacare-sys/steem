'use strict';
/**
 * src/lib/solvencyFederationConsensusArchive407.js — ECOS V407 (Phase P295) —
 * Federation Consensus Snapshot Archive.
 *
 * Captures V406 consensus snapshots into an append-only archive, each entry
 * signed with an operator-local HMAC secret so an offline auditor can later
 * verify that a given consensus snapshot was produced by this operator at
 * the recorded time without trusting the storage medium.
 *
 * Pure, deterministic. No new npm deps (R3). Sacred read-only (R1).
 * Identifiers end in 407 (R2).
 *
 * @version 407.0.0
 */

const crypto = require('crypto');

const CONSENSUS_ARCHIVE_VERSION_407 = '407.0.0';
const _sha407 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const _hmac407 = (secret, s) => crypto.createHmac('sha256', secret).update(s).digest('hex');

function _stable407(obj) {
  // Deterministic JSON: keys sorted, arrays preserved.
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(_stable407).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + _stable407(obj[k])).join(',') + '}';
}

function createSolvencyFederationConsensusArchive407(opts) {
  opts = opts || {};
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const secret = opts.secret;
  if (!secret || typeof secret !== 'string' || secret.length < 16) {
    throw new Error('secret (string, len>=16) required');
  }
  const maxEntries = Number.isFinite(opts.maxEntries) ? Math.max(16, opts.maxEntries | 0) : 1024;

  const archive = []; // { seq, capturedAt, snapshotHash, signature, snapshot }
  let nextSeq = 1;

  function captureSnapshot407(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') throw new Error('snapshot required');
    const capturedAt = now();
    const seq = nextSeq++;
    const body = _stable407({ seq, capturedAt, snapshot });
    const snapshotHash = _sha407('cons-arch407|' + body);
    const signature = _hmac407(secret, snapshotHash);
    const rec = { seq, capturedAt, snapshotHash, signature, snapshot };
    archive.push(rec);
    while (archive.length > maxEntries) archive.shift();
    return { ok: true, seq, capturedAt, snapshotHash, signature };
  }

  function verifyArchived407(record) {
    if (!record || !record.snapshot || !record.signature || !record.snapshotHash) {
      return { valid: false, reason: 'missing fields' };
    }
    const body = _stable407({ seq: record.seq, capturedAt: record.capturedAt, snapshot: record.snapshot });
    const recomputed = _sha407('cons-arch407|' + body);
    if (recomputed !== record.snapshotHash) {
      return { valid: false, reason: 'snapshot_hash_mismatch_407' };
    }
    const expectedSig = _hmac407(secret, recomputed);
    if (expectedSig !== record.signature) {
      return { valid: false, reason: 'signature_mismatch_407' };
    }
    return { valid: true };
  }

  function listArchive407(limit) {
    const n = Number.isFinite(limit) ? Math.max(1, limit | 0) : archive.length;
    return archive.slice(-n).map(r => ({
      seq: r.seq, capturedAt: r.capturedAt,
      snapshotHash: r.snapshotHash, signature: r.signature,
    }));
  }

  function fetch407(seq) {
    const rec = archive.find(r => r.seq === (seq | 0));
    return rec ? Object.assign({}, rec) : null;
  }

  function stats407() {
    return { archived: archive.length, nextSeq, maxEntries };
  }

  return { captureSnapshot407, verifyArchived407, listArchive407, fetch407, stats407 };
}

module.exports = {
  CONSENSUS_ARCHIVE_VERSION_407,
  createSolvencyFederationConsensusArchive407,
};
