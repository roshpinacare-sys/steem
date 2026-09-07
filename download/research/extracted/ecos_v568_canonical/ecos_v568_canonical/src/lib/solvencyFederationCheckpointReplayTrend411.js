'use strict';
/**
 * src/lib/solvencyFederationCheckpointReplayTrend411.js — ECOS V411
 * (Phase P299) — Checkpoint Replay Trend.
 *
 * Ingests successive V410 checkpoint-replay reports (which only expose
 * the *last* report) and tracks a longitudinal trend so an auditor can
 * see violation deltas over time, current valid-run length, and the
 * longest unbroken stretch of clean replays observed.
 *
 * Pure, deterministic. No new npm deps (R3). Sacred read-only (R1).
 * Identifiers end in 411 (R2).
 *
 * @version 411.0.0
 */

const CHECKPOINT_REPLAY_TREND_VERSION_411 = '411.0.0';

function createSolvencyFederationCheckpointReplayTrend411(opts) {
  opts = opts || {};
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const maxSamples = Number.isFinite(opts.maxSamples)
    ? Math.max(16, opts.maxSamples | 0)
    : 2048;

  const samples = []; // { seq, ts, length, violations, delta, valid }
  let nextSeq = 1;
  let lastViolationsTotal = 0;
  let currentValidRun = 0;
  let longestValidRun = 0;
  let totalIngested = 0;
  let lastReportRef = null;

  function ingest411(checkpointReplay410) {
    if (!checkpointReplay410 || typeof checkpointReplay410.getLastReport410 !== 'function') {
      throw new Error('checkpointReplay410 required');
    }
    const report = checkpointReplay410.getLastReport410();
    if (!report) {
      return { ok: false, reason: 'no_report_to_ingest_411' };
    }
    if (lastReportRef && lastReportRef === report) {
      return { ok: false, reason: 'report_already_ingested_411' };
    }
    lastReportRef = report;
    const violations = report.violations ? report.violations.length : 0;
    const delta = violations - lastViolationsTotal;
    lastViolationsTotal = violations;
    if (report.valid) {
      currentValidRun++;
      if (currentValidRun > longestValidRun) longestValidRun = currentValidRun;
    } else {
      currentValidRun = 0;
    }
    const sample = {
      seq: nextSeq++,
      ts: now(),
      length: report.length || 0,
      violations,
      delta,
      valid: !!report.valid,
    };
    samples.push(sample);
    while (samples.length > maxSamples) samples.shift();
    totalIngested++;
    return { ok: true, sample: Object.assign({}, sample) };
  }

  function list411(limit) {
    const n = Number.isFinite(limit) ? Math.max(1, limit | 0) : samples.length;
    return samples.slice(-n).map((s) => Object.assign({}, s));
  }

  function stats411() {
    return {
      samples: samples.length,
      nextSeq,
      totalIngested,
      lastViolationsTotal,
      currentValidRun,
      longestValidRun,
    };
  }

  return { ingest411, list411, stats411 };
}

module.exports = {
  CHECKPOINT_REPLAY_TREND_VERSION_411,
  createSolvencyFederationCheckpointReplayTrend411,
};
