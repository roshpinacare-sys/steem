'use strict';
/**
 * src/lib/solvencyFederationQuorumCheckpoint409.js — ECOS V409 (Phase P297) —
 * Federation Quorum History Checkpoints.
 *
 * Periodically captures the head of the V408 quorum-history chain into a
 * HMAC-signed checkpoint so an auditor can pin the federation's
 * operator-observed quorum state at discrete points in time and detect
 * any silent rewrite of the chain between checkpoints.
 *
 * Pure, deterministic. No new npm deps (R3). Sacred read-only (R1).
 * Identifiers end in 409 (R2).
 *
 * @version 409.0.0
 */

const crypto = require('crypto');

const QUORUM_CHECKPOINT_VERSION_409 = '409.0.0';

const _hmac409 = (secret, s) =>
  crypto.createHmac('sha256', secret).update(s).digest('hex');

function createSolvencyFederationQuorumCheckpoint409(opts) {
  opts = opts || {};
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const secret = typeof opts.secret === 'string' && opts.secret.length >= 16
    ? opts.secret
    : null;
  if (!secret) throw new Error('secret (>=16 chars) required');
  const maxCheckpoints = Number.isFinite(opts.maxCheckpoints)
    ? Math.max(16, opts.maxCheckpoints | 0)
    : 1024;

  const checkpoints = []; // { seq, ts, head, entries, reached, missed, signature }
  let nextSeq = 1;

  function capture409(history408) {
    if (!history408 || typeof history408.stats408 !== 'function') {
      throw new Error('history408 required');
    }
    const s = history408.stats408();
    const ts = now();
    const seq = nextSeq++;
    const payload = 'quorum-checkpoint409|' + seq + '|' + ts + '|' + s.head +
      '|' + s.entries + '|' + s.reached + '|' + s.missed;
    const signature = _hmac409(secret, payload);
    const rec = {
      seq, ts,
      head: s.head,
      entries: s.entries,
      reached: s.reached,
      missed: s.missed,
      signature,
    };
    checkpoints.push(rec);
    while (checkpoints.length > maxCheckpoints) checkpoints.shift();
    return { ok: true, checkpoint: rec };
  }

  function list409(limit) {
    const n = Number.isFinite(limit) ? Math.max(1, limit | 0) : checkpoints.length;
    return checkpoints.slice(-n).map((r) => Object.assign({}, r));
  }

  function verifyCheckpoint409(checkpoint) {
    if (!checkpoint || typeof checkpoint !== 'object') {
      return { valid: false, reason: 'checkpoint_required_409' };
    }
    const payload = 'quorum-checkpoint409|' + checkpoint.seq + '|' + checkpoint.ts +
      '|' + checkpoint.head + '|' + checkpoint.entries +
      '|' + checkpoint.reached + '|' + checkpoint.missed;
    const expected = _hmac409(secret, payload);
    return {
      valid: expected === checkpoint.signature,
      reason: expected === checkpoint.signature ? null : 'signature_mismatch_409',
    };
  }

  function verifyAll409() {
    for (const cp of checkpoints) {
      const v = verifyCheckpoint409(cp);
      if (!v.valid) return { valid: false, brokenAtSeq: cp.seq, reason: v.reason };
    }
    return { valid: true, length: checkpoints.length };
  }

  function stats409() {
    return {
      checkpoints: checkpoints.length,
      nextSeq,
      lastHead: checkpoints.length ? checkpoints[checkpoints.length - 1].head : null,
      lastTs: checkpoints.length ? checkpoints[checkpoints.length - 1].ts : 0,
    };
  }

  return { capture409, list409, verifyCheckpoint409, verifyAll409, stats409 };
}

module.exports = {
  QUORUM_CHECKPOINT_VERSION_409,
  createSolvencyFederationQuorumCheckpoint409,
};
