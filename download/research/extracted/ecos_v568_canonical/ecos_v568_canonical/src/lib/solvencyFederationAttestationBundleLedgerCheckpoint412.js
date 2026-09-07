'use strict';
/**
 * src/lib/solvencyFederationAttestationBundleLedgerCheckpoint412.js — ECOS V412
 * (Phase P300) — Attestation Bundle Ledger Checkpoint.
 *
 * Produces HMAC-signed checkpoints over the V411 attestation bundle ledger
 * head. A checkpoint captures `{ headHash, length, totalAppends }` from
 * V411 `bundleLedger411.stats411()`, with a monotonically increasing
 * `checkpointSeq412`, signed using a shared secret so external auditors
 * can pin a head value at a moment in time without scanning the full
 * chain. Idempotent per `headHash`.
 *
 * Pure, deterministic. No new npm deps (R3). Sacred read-only (R1).
 * Identifiers end in 412 (R2).
 *
 * @version 412.0.0
 */

const crypto = require('crypto');

const ATTESTATION_BUNDLE_LEDGER_CHECKPOINT_VERSION_412 = '412.0.0';

function _sign412(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function createSolvencyFederationAttestationBundleLedgerCheckpoint412(opts) {
  opts = opts || {};
  const secret = typeof opts.secret === 'string' && opts.secret.length >= 16
    ? opts.secret
    : 'ecos-v412-default-secret-checkpoint-pad';
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const maxCheckpoints = Number.isFinite(opts.maxCheckpoints)
    ? Math.max(16, opts.maxCheckpoints | 0)
    : 2048;

  const checkpoints = [];
  const seenHeads = new Set();
  let nextSeq412 = 1;
  let totalCheckpoints412 = 0;

  function checkpoint412(bundleLedger411) {
    if (!bundleLedger411 || typeof bundleLedger411.stats411 !== 'function') {
      throw new Error('bundleLedger411 required');
    }
    const s = bundleLedger411.stats411();
    if (!s.hasEntries) {
      return { ok: false, reason: 'no_ledger_entries_to_checkpoint_412' };
    }
    if (seenHeads.has(s.headHash)) {
      return { ok: false, reason: 'head_already_checkpointed_412',
        headHash: s.headHash };
    }
    const body = {
      checkpointSeq412: nextSeq412,
      ts: now(),
      headHash: s.headHash,
      length: s.entries,
      totalAppends: s.totalAppends,
    };
    const contentHash = crypto.createHash('sha256')
      .update('v412-bundle-ledger-checkpoint|' + JSON.stringify(body))
      .digest('hex');
    const signature = _sign412(secret, contentHash);
    const checkpoint = Object.assign({}, body, { contentHash, signature });
    checkpoints.push(checkpoint);
    while (checkpoints.length > maxCheckpoints) checkpoints.shift();
    seenHeads.add(s.headHash);
    nextSeq412++;
    totalCheckpoints412++;
    return { ok: true, checkpoint: Object.assign({}, checkpoint) };
  }

  function verify412(checkpoint) {
    if (!checkpoint || !checkpoint.contentHash || !checkpoint.signature) {
      return { valid: false, reason: 'malformed_checkpoint_412' };
    }
    const expected = _sign412(secret, checkpoint.contentHash);
    if (expected !== checkpoint.signature) {
      return { valid: false, reason: 'signature_mismatch_412' };
    }
    return { valid: true };
  }

  function list412(limit) {
    const n = Number.isFinite(limit) ? Math.max(1, limit | 0) : checkpoints.length;
    return checkpoints.slice(-n).map((c) => Object.assign({}, c));
  }

  function getLastCheckpoint412() {
    return checkpoints.length > 0
      ? Object.assign({}, checkpoints[checkpoints.length - 1])
      : null;
  }

  function stats412() {
    return {
      checkpoints: checkpoints.length,
      nextSeq412,
      totalCheckpoints412,
      hasCheckpoints: checkpoints.length > 0,
    };
  }

  return { checkpoint412, verify412, list412, getLastCheckpoint412, stats412 };
}

module.exports = {
  ATTESTATION_BUNDLE_LEDGER_CHECKPOINT_VERSION_412,
  createSolvencyFederationAttestationBundleLedgerCheckpoint412,
};
