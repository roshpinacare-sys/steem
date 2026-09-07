'use strict';
/**
 * src/lib/solvencyFederationCheckpointReplay410.js — ECOS V410 (Phase P298) —
 * Quorum Checkpoint Replay Verifier.
 *
 * Replays an ordered list of V409 quorum checkpoints and reports any
 * monotonicity violations (head/entries/reached/missed must be
 * non-decreasing) plus any HMAC signature mismatch. Lets an auditor
 * confirm that the federation's checkpoint stream never rewound or
 * silently swapped a checkpoint between captures.
 *
 * Pure, deterministic. No new npm deps (R3). Sacred read-only (R1).
 * Identifiers end in 410 (R2).
 *
 * @version 410.0.0
 */

const CHECKPOINT_REPLAY_VERSION_410 = '410.0.0';

function createSolvencyFederationCheckpointReplay410(opts) {
  opts = opts || {};
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();

  let lastReport = null;
  let totalReplays = 0;
  let totalViolations = 0;

  function replay410(checkpoint409, checkpoints) {
    if (!checkpoint409 || typeof checkpoint409.verifyCheckpoint409 !== 'function') {
      throw new Error('checkpoint409 required');
    }
    const list = Array.isArray(checkpoints)
      ? checkpoints
      : checkpoint409.list409();
    const violations = [];
    let prev = null;
    for (const cp of list) {
      const v = checkpoint409.verifyCheckpoint409(cp);
      if (!v.valid) {
        violations.push({ seq: cp.seq, kind: 'signature_invalid_410', reason: v.reason });
        prev = cp;
        continue;
      }
      if (prev) {
        if (cp.seq <= prev.seq) {
          violations.push({ seq: cp.seq, kind: 'seq_regression_410',
            prevSeq: prev.seq });
        }
        if (cp.entries < prev.entries) {
          violations.push({ seq: cp.seq, kind: 'entries_regression_410',
            prev: prev.entries, curr: cp.entries });
        }
        if (cp.reached < prev.reached) {
          violations.push({ seq: cp.seq, kind: 'reached_regression_410',
            prev: prev.reached, curr: cp.reached });
        }
        if (cp.missed < prev.missed) {
          violations.push({ seq: cp.seq, kind: 'missed_regression_410',
            prev: prev.missed, curr: cp.missed });
        }
        if (cp.ts < prev.ts) {
          violations.push({ seq: cp.seq, kind: 'ts_regression_410',
            prev: prev.ts, curr: cp.ts });
        }
      }
      prev = cp;
    }
    totalReplays++;
    totalViolations += violations.length;
    lastReport = {
      replayedAt: now(),
      length: list.length,
      violations,
      valid: violations.length === 0,
    };
    return { ok: true, report: lastReport };
  }

  function getLastReport410() {
    return lastReport;
  }

  function stats410() {
    return {
      totalReplays,
      totalViolations,
      lastValid: lastReport ? lastReport.valid : null,
      lastLength: lastReport ? lastReport.length : 0,
    };
  }

  return { replay410, getLastReport410, stats410 };
}

module.exports = {
  CHECKPOINT_REPLAY_VERSION_410,
  createSolvencyFederationCheckpointReplay410,
};
