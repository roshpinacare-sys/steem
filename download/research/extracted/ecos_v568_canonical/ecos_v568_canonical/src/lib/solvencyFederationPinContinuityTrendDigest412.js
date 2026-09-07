'use strict';
/**
 * src/lib/solvencyFederationPinContinuityTrendDigest412.js — ECOS V412
 * (Phase P300) — Pin Continuity Trend Digest.
 *
 * Produces an HMAC-signed digest snapshot over the V411 pin continuity
 * trend (stats + last-N samples). Lets an auditor pin a single
 * tamper-evident summary value for archive pin-continuity reliability.
 * Idempotent per `samplesHash`.
 *
 * Pure, deterministic. No new npm deps (R3). Sacred read-only (R1).
 * Identifiers end in 412 (R2).
 *
 * @version 412.0.0
 */

const crypto = require('crypto');

const PIN_CONTINUITY_TREND_DIGEST_VERSION_412 = '412.0.0';

function _sign412(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function createSolvencyFederationPinContinuityTrendDigest412(opts) {
  opts = opts || {};
  const secret = typeof opts.secret === 'string' && opts.secret.length >= 16
    ? opts.secret
    : 'ecos-v412-default-secret-pin-digest-pad';
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const maxDigests = Number.isFinite(opts.maxDigests)
    ? Math.max(16, opts.maxDigests | 0)
    : 1024;

  const digests = [];
  const seenSamplesHashes = new Set();
  let nextSeq412 = 1;
  let totalDigests412 = 0;

  function digest412(pinTrend411) {
    if (!pinTrend411 || typeof pinTrend411.stats411 !== 'function'
        || typeof pinTrend411.list411 !== 'function') {
      throw new Error('pinTrend411 required');
    }
    const stats = pinTrend411.stats411();
    if (!stats || stats.samples === 0) {
      return { ok: false, reason: 'no_trend_samples_to_digest_412' };
    }
    const samples = pinTrend411.list411();
    const samplesHash = crypto.createHash('sha256')
      .update('v412-pin-trend-samples|' + JSON.stringify(samples))
      .digest('hex');
    if (seenSamplesHashes.has(samplesHash)) {
      return { ok: false, reason: 'trend_already_digested_412', samplesHash };
    }
    const body = {
      digestSeq412: nextSeq412,
      ts: now(),
      samplesHash,
      sampleCount: samples.length,
      lastAnomaliesTotal: stats.lastAnomaliesTotal,
      currentCleanStreak: stats.currentCleanStreak,
      longestCleanStreak: stats.longestCleanStreak,
      lastAnomalyAt: stats.lastAnomalyAt,
    };
    const contentHash = crypto.createHash('sha256')
      .update('v412-pin-trend-digest|' + JSON.stringify(body))
      .digest('hex');
    const signature = _sign412(secret, contentHash);
    const d = Object.assign({}, body, { contentHash, signature });
    digests.push(d);
    while (digests.length > maxDigests) digests.shift();
    seenSamplesHashes.add(samplesHash);
    nextSeq412++;
    totalDigests412++;
    return { ok: true, digest: Object.assign({}, d) };
  }

  function verify412(d) {
    if (!d || !d.contentHash || !d.signature) {
      return { valid: false, reason: 'malformed_digest_412' };
    }
    const expected = _sign412(secret, d.contentHash);
    if (expected !== d.signature) {
      return { valid: false, reason: 'signature_mismatch_412' };
    }
    return { valid: true };
  }

  function list412(limit) {
    const n = Number.isFinite(limit) ? Math.max(1, limit | 0) : digests.length;
    return digests.slice(-n).map((x) => Object.assign({}, x));
  }

  function getLastDigest412() {
    return digests.length > 0
      ? Object.assign({}, digests[digests.length - 1])
      : null;
  }

  function stats412() {
    return {
      digests: digests.length,
      nextSeq412,
      totalDigests412,
      hasDigests: digests.length > 0,
    };
  }

  return { digest412, verify412, list412, getLastDigest412, stats412 };
}

module.exports = {
  PIN_CONTINUITY_TREND_DIGEST_VERSION_412,
  createSolvencyFederationPinContinuityTrendDigest412,
};
