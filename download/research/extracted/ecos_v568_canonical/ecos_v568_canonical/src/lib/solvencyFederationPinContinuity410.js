'use strict';
/**
 * src/lib/solvencyFederationPinContinuity410.js — ECOS V410 (Phase P298) —
 * Archive Pin Continuity Monitor.
 *
 * Scans the V409 archive-pin registry and reports continuity anomalies:
 *   - chain integrity (delegated to V409 verifyChain409)
 *   - time gaps between consecutive pins exceeding `maxGapMs`
 *   - stale runs where the same archive digest is pinned more than
 *     `maxStaleRepeats` times in a row (indicates archive stopped growing)
 *   - headSeq regressions (archive shrank between pins)
 *
 * Pure, deterministic. No new npm deps (R3). Sacred read-only (R1).
 * Identifiers end in 410 (R2).
 *
 * @version 410.0.0
 */

const PIN_CONTINUITY_VERSION_410 = '410.0.0';

function createSolvencyFederationPinContinuity410(opts) {
  opts = opts || {};
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const maxGapMs = Number.isFinite(opts.maxGapMs)
    ? Math.max(1, opts.maxGapMs | 0)
    : 60 * 60 * 1000; // 1h default
  const maxStaleRepeats = Number.isFinite(opts.maxStaleRepeats)
    ? Math.max(2, opts.maxStaleRepeats | 0)
    : 3;

  let lastReport = null;
  let totalScans = 0;
  let totalAnomalies = 0;

  function scan410(pinRegistry409) {
    if (!pinRegistry409 || typeof pinRegistry409.list409 !== 'function') {
      throw new Error('pinRegistry409 required');
    }
    const pins = pinRegistry409.list409();
    const anomalies = [];

    const chain = typeof pinRegistry409.verifyChain409 === 'function'
      ? pinRegistry409.verifyChain409()
      : { valid: true };
    if (!chain.valid) {
      anomalies.push({
        kind: 'chain_invalid_410',
        brokenAtSeq: chain.brokenAtSeq,
        reason: chain.reason,
      });
    }

    let prev = null;
    let runDigest = null;
    let runLen = 0;
    for (const p of pins) {
      if (prev) {
        const gap = p.ts - prev.ts;
        if (gap > maxGapMs) {
          anomalies.push({
            kind: 'time_gap_410',
            seq: p.seq,
            prevSeq: prev.seq,
            gapMs: gap,
            maxGapMs,
          });
        }
        if (p.headSeq < prev.headSeq) {
          anomalies.push({
            kind: 'head_seq_regression_410',
            seq: p.seq,
            prev: prev.headSeq,
            curr: p.headSeq,
          });
        }
        if (p.count < prev.count) {
          anomalies.push({
            kind: 'count_regression_410',
            seq: p.seq,
            prev: prev.count,
            curr: p.count,
          });
        }
      }
      if (runDigest === p.digest) {
        runLen++;
        if (runLen === maxStaleRepeats + 1) {
          anomalies.push({
            kind: 'stale_digest_410',
            seq: p.seq,
            digest: p.digest,
            repeats: runLen,
            maxStaleRepeats,
          });
        }
      } else {
        runDigest = p.digest;
        runLen = 1;
      }
      prev = p;
    }

    totalScans++;
    totalAnomalies += anomalies.length;
    lastReport = {
      scannedAt: now(),
      length: pins.length,
      anomalies,
      valid: anomalies.length === 0,
    };
    return { ok: true, report: lastReport };
  }

  function getLastReport410() {
    return lastReport;
  }

  function stats410() {
    return {
      totalScans,
      totalAnomalies,
      lastValid: lastReport ? lastReport.valid : null,
      lastLength: lastReport ? lastReport.length : 0,
      maxGapMs,
      maxStaleRepeats,
    };
  }

  return { scan410, getLastReport410, stats410 };
}

module.exports = {
  PIN_CONTINUITY_VERSION_410,
  createSolvencyFederationPinContinuity410,
};
