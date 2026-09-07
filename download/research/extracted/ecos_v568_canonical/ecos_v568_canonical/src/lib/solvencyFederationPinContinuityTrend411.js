'use strict';
/**
 * src/lib/solvencyFederationPinContinuityTrend411.js — ECOS V411
 * (Phase P299) — Pin Continuity Trend.
 *
 * Ingests successive V410 pin-continuity reports and tracks a
 * longitudinal trend so an auditor can see anomaly deltas over time,
 * the current anomaly-free streak, the longest historical clean
 * streak, and when the last anomaly was observed.
 *
 * Pure, deterministic. No new npm deps (R3). Sacred read-only (R1).
 * Identifiers end in 411 (R2).
 *
 * @version 411.0.0
 */

const PIN_CONTINUITY_TREND_VERSION_411 = '411.0.0';

function createSolvencyFederationPinContinuityTrend411(opts) {
  opts = opts || {};
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const maxSamples = Number.isFinite(opts.maxSamples)
    ? Math.max(16, opts.maxSamples | 0)
    : 2048;

  const samples = []; // { seq, ts, length, anomalies, delta, valid }
  let nextSeq = 1;
  let lastAnomaliesTotal = 0;
  let currentCleanStreak = 0;
  let longestCleanStreak = 0;
  let lastAnomalyAt = 0;
  let totalIngested = 0;
  let lastReportRef = null;

  function ingest411(pinContinuity410) {
    if (!pinContinuity410 || typeof pinContinuity410.getLastReport410 !== 'function') {
      throw new Error('pinContinuity410 required');
    }
    const report = pinContinuity410.getLastReport410();
    if (!report) {
      return { ok: false, reason: 'no_report_to_ingest_411' };
    }
    if (lastReportRef && lastReportRef === report) {
      return { ok: false, reason: 'report_already_ingested_411' };
    }
    lastReportRef = report;
    const anomalies = report.anomalies ? report.anomalies.length : 0;
    const delta = anomalies - lastAnomaliesTotal;
    lastAnomaliesTotal = anomalies;
    const ts = now();
    if (report.valid) {
      currentCleanStreak++;
      if (currentCleanStreak > longestCleanStreak) longestCleanStreak = currentCleanStreak;
    } else {
      currentCleanStreak = 0;
      lastAnomalyAt = ts;
    }
    const sample = {
      seq: nextSeq++,
      ts,
      length: report.length || 0,
      anomalies,
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
      lastAnomaliesTotal,
      currentCleanStreak,
      longestCleanStreak,
      lastAnomalyAt,
    };
  }

  return { ingest411, list411, stats411 };
}

module.exports = {
  PIN_CONTINUITY_TREND_VERSION_411,
  createSolvencyFederationPinContinuityTrend411,
};
