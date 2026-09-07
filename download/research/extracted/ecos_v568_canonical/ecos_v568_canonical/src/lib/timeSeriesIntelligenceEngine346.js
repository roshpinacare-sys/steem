'use strict';
  /**
   * lib/timeSeriesIntelligenceEngine346.js — ECOS V346 (Phase P234)
   * Time-Series Intelligence Engine
   *
   * Extends V345 with four intelligence tools on top of the time-series layer:
   *
   *   V345 → period grouping, snapshot diff, suppression registry, webhook emitter
   *   V346 → anomaly detection, SLA compliance, suppression audit log, webhook retry
   *
   * Four concrete tools:
   *
   *   1. detectTimeSeriesAnomalies346   — scans per-period avgScore for anomalies
   *      (sudden drops, long-term drift, isolated spikes) using a configurable
   *      z-score window. Returns { anomalies[], anomalyCount, severity, version }.
   *
   *   2. buildSlaComplianceReport346    — evaluates whether each period's avgScore
   *      met a configured SLA target (e.g. "≥80 for 90% of weekly periods").
   *      Returns per-SLA pass/fail with breach counts and compliance percentage.
   *
   *   3. buildSuppressionAuditLog346    — takes a suppression registry (V345) and
   *      a list of timestamped alert events, classifies each event as suppressed or
   *      not-suppressed, and returns a structured audit log with summary counts.
   *
   *   4. buildWebhookRetryPlan346       — reads failed V345 webhook receipt objects,
   *      applies exponential backoff scheduling, and returns an ordered retry plan
   *      with next-attempt timestamps and attempt numbers. Pure / no side effects.
   *
   * Pure / dependency-free (R3). All new public identifiers end with `346` (R2).
   * Sacred files (fiatLedger.js, auditLog.js) untouched (R1). Additive only (R6).
   *
   * @version 346.0.0
   */

  const fs     = require('fs');
  const path   = require('path');
  const crypto = require('crypto');

  const TIME_SERIES_INTELLIGENCE_VERSION_346 = '346.0.0';

  /* ─── helpers ─────────────────────────────────────────────────────────────── */

  function _anomalyReportId346(ts) {
    return 'anomaly_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
  }

  function _slaReportId346(ts) {
    return 'sla_report_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
  }

  function _auditLogId346(ts) {
    return 'suppression_audit_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
  }

  function _retryPlanId346(ts) {
    return 'retry_plan_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
  }

  function _hashContent346(str) {
    return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
  }

  /** Compute mean and stddev of a numeric array */
  function _stats346(arr) {
    if (!arr || arr.length === 0) return { mean: null, stddev: null };
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
    return { mean, stddev: Math.sqrt(variance) };
  }

  /* ─── 1. detectTimeSeriesAnomalies346 ────────────────────────────────────────*/

  /**
   * Scan per-period avgScore for anomalies using a z-score approach.
   * Anomaly types: 'sudden_drop', 'sudden_spike', 'long_term_drift'.
   *
   * @param {object} timeSeries   Output of buildDashboardTimeSeries345 — must have .periods[]
   * @param {object} [opts]
   * @param {number} [opts.zScoreThreshold=2.0]   z-score beyond which a point is flagged
   * @param {number} [opts.driftWindowSize=3]      min consecutive degraded periods for drift
   * @param {number} [opts.minPeriods=2]           skip if fewer than this many periods
   * @param {string} [opts.label]
   * @returns {{ ok, anomalyReportId, generatedAt, anomalies, anomalyCount,
   *             severity, totalPeriods, version, summary }}
   */
  function detectTimeSeriesAnomalies346(timeSeries, opts) {
    opts = opts || {};
    const zThreshold   = typeof opts.zScoreThreshold === 'number' ? opts.zScoreThreshold : 2.0;
    const driftWindow  = typeof opts.driftWindowSize  === 'number' ? opts.driftWindowSize  : 3;
    const minPeriods   = typeof opts.minPeriods       === 'number' ? opts.minPeriods       : 2;
    const label        = typeof opts.label === 'string' ? opts.label : 'fleet';
    const ts           = new Date();
    const reportId     = _anomalyReportId346(ts);

    const periods = (timeSeries && Array.isArray(timeSeries.periods)) ? timeSeries.periods : [];

    if (periods.length < minPeriods) {
      return {
        ok: true, anomalyReportId: reportId, generatedAt: ts.toISOString(),
        anomalies: [], anomalyCount: 0, severity: 'none',
        totalPeriods: periods.length, label,
        version: TIME_SERIES_INTELLIGENCE_VERSION_346,
        summary: `V346 anomaly: insufficient data (${periods.length} periods, need ≥${minPeriods})`,
      };
    }

    // Extract scores
    const scores = periods.map(p => (typeof p.avgScore === 'number' ? p.avgScore : null));
    const validScores = scores.filter(s => s !== null);
    const { mean, stddev } = _stats346(validScores);

    const anomalies = [];

    // Z-score pass — flag sudden drops/spikes
    for (let i = 0; i < periods.length; i++) {
      const score = scores[i];
      if (score === null) continue;
      if (stddev === 0 || stddev === null) continue;
      const z = (score - mean) / stddev;
      if (z < -zThreshold) {
        anomalies.push({
          period: periods[i].period, type: 'sudden_drop',
          avgScore: score, zScore: Math.round(z * 100) / 100,
          mean: Math.round(mean * 10) / 10, stddev: Math.round(stddev * 10) / 10,
          details: `Score ${score} is ${Math.abs(Math.round(z * 10) / 10)} stddevs below mean`,
        });
      } else if (z > zThreshold) {
        anomalies.push({
          period: periods[i].period, type: 'sudden_spike',
          avgScore: score, zScore: Math.round(z * 100) / 100,
          mean: Math.round(mean * 10) / 10, stddev: Math.round(stddev * 10) / 10,
          details: `Score ${score} is ${Math.round(z * 10) / 10} stddevs above mean`,
        });
      }
    }

    // Long-term drift — driftWindow consecutive periods with below-mean scores
    let driftRun = 0;
    let driftStart = null;
    for (let i = 0; i < periods.length; i++) {
      const score = scores[i];
      if (score !== null && mean !== null && score < mean) {
        if (driftRun === 0) driftStart = periods[i].period;
        driftRun++;
        if (driftRun === driftWindow) {
          anomalies.push({
            period: periods[i].period, type: 'long_term_drift',
            avgScore: score, zScore: null,
            driftStart, driftLength: driftRun,
            mean: Math.round(mean * 10) / 10,
            details: `${driftRun} consecutive below-mean periods starting ${driftStart}`,
          });
        }
      } else {
        driftRun = 0; driftStart = null;
      }
    }

    // Deduplicate (long_term_drift may overlap sudden_drop periods)
    const seen = new Set();
    const deduped = anomalies.filter(a => {
      const key = a.period + '|' + a.type;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });

    // Severity
    let severity = 'none';
    if (deduped.length > 0) {
      const hasDrop = deduped.some(a => a.type === 'sudden_drop');
      const hasDrift = deduped.some(a => a.type === 'long_term_drift');
      severity = (hasDrop || hasDrift) ? (deduped.length >= 3 ? 'critical' : 'warning') : 'info';
    }

    return {
      ok: true, anomalyReportId: reportId, generatedAt: ts.toISOString(),
      anomalies: deduped, anomalyCount: deduped.length, severity,
      totalPeriods: periods.length, label,
      version: TIME_SERIES_INTELLIGENCE_VERSION_346,
      summary: `V346 anomaly: ${deduped.length} anomalies detected in ${periods.length} periods, severity=${severity}`,
    };
  }

  /* ─── 2. buildSlaComplianceReport346 ─────────────────────────────────────────*/

  /**
   * Evaluate whether time-series periods met configured SLA targets.
   *
   * Each SLA target spec: { id, name, minScore, requiredCompliance }
   *   - minScore: per-period avgScore must be >= this value to be compliant
   *   - requiredCompliance: fraction [0..1] of periods that must pass (e.g. 0.9)
   *
   * @param {object}   timeSeries   Output of buildDashboardTimeSeries345
   * @param {Array}    slaTargets   Array of SLA target specs
   * @param {object}   [opts]
   * @returns {{ ok, slaReportId, generatedAt, results, overallPass,
   *             passCount, failCount, version, summary }}
   */
  function buildSlaComplianceReport346(timeSeries, slaTargets, opts) {
    opts = opts || {};
    const ts       = new Date();
    const reportId = _slaReportId346(ts);

    const periods = (timeSeries && Array.isArray(timeSeries.periods)) ? timeSeries.periods : [];
    const targets = Array.isArray(slaTargets) ? slaTargets : [];

    if (targets.length === 0) {
      return {
        ok: true, slaReportId: reportId, generatedAt: ts.toISOString(),
        results: [], overallPass: true, passCount: 0, failCount: 0,
        version: TIME_SERIES_INTELLIGENCE_VERSION_346,
        summary: 'V346 SLA: no SLA targets defined',
      };
    }

    const results = [];
    for (const target of targets) {
      if (!target || typeof target !== 'object') continue;
      const id               = target.id || 'sla-' + results.length;
      const name             = target.name || id;
      const minScore         = typeof target.minScore === 'number' ? target.minScore : 80;
      const reqCompliance    = typeof target.requiredCompliance === 'number'
        ? Math.min(1, Math.max(0, target.requiredCompliance)) : 0.9;

      const scored = periods.filter(p => typeof p.avgScore === 'number');
      const passing = scored.filter(p => p.avgScore >= minScore);
      const compliancePct = scored.length > 0 ? passing.length / scored.length : 0;
      const pass = compliancePct >= reqCompliance;

      const breaches = scored.filter(p => p.avgScore < minScore).map(p => ({
        period: p.period, avgScore: p.avgScore, delta: Math.round((minScore - p.avgScore) * 10) / 10,
      }));

      results.push({
        id, name, minScore, requiredCompliance: reqCompliance,
        totalPeriods: scored.length, passingPeriods: passing.length,
        compliancePct: Math.round(compliancePct * 1000) / 10,  // e.g. 87.5
        pass, breachCount: breaches.length, breaches,
      });
    }

    const passCount = results.filter(r => r.pass).length;
    const failCount = results.filter(r => !r.pass).length;
    const overallPass = failCount === 0;

    return {
      ok: true, slaReportId: reportId, generatedAt: ts.toISOString(),
      results, overallPass, passCount, failCount,
      version: TIME_SERIES_INTELLIGENCE_VERSION_346,
      summary: `V346 SLA: ${passCount}/${results.length} targets passing` +
               (failCount > 0 ? `, ${failCount} FAILING` : ''),
    };
  }

  /* ─── 3. buildSuppressionAuditLog346 ─────────────────────────────────────────*/

  /**
   * Classify a list of timestamped alert events against a V345 suppression registry.
   * Returns a structured audit log: each event tagged as suppressed or active,
   * with the matching rule name when suppressed.
   *
   * @param {object} registry   Output of buildAlertSuppressionRegistry345
   *                            (must expose registry.isSuppressed function or registry.rules)
   * @param {Array}  events     Array of { id?, name?, timestamp, family? }
   * @param {object} [opts]
   * @returns {{ ok, auditLogId, generatedAt, entries, suppressedCount, activeCount,
   *             totalEvents, version, summary }}
   */
  function buildSuppressionAuditLog346(registry, events, opts) {
    opts = opts || {};
    const ts       = new Date();
    const logId    = _auditLogId346(ts);

    const safeEvents = Array.isArray(events) ? events : [];
    const isSuppressedFn = (registry && typeof registry.isSuppressed === 'function')
      ? registry.isSuppressed : () => ({ suppressed: false, rule: null });

    const entries = safeEvents.map((evt, idx) => {
      if (!evt || typeof evt !== 'object') {
        return { index: idx, id: null, name: null, timestamp: null,
                 suppressed: false, rule: null, error: 'invalid event' };
      }
      const id        = evt.id || `event-${idx}`;
      const name      = evt.name || id;
      const timestamp = evt.timestamp || evt.capturedAt || evt.generatedAt || null;
      const family    = evt.family || evt.familyName || null;
      const result    = isSuppressedFn(family, timestamp);
      return {
        index: idx, id, name, family, timestamp,
        suppressed: result.suppressed, rule: result.rule || null,
      };
    });

    const suppressedCount = entries.filter(e => e.suppressed).length;
    const activeCount     = entries.filter(e => !e.suppressed && !e.error).length;

    return {
      ok: true, auditLogId: logId, generatedAt: ts.toISOString(),
      entries, suppressedCount, activeCount, totalEvents: safeEvents.length,
      version: TIME_SERIES_INTELLIGENCE_VERSION_346,
      summary: `V346 suppression audit: ${suppressedCount} suppressed, ${activeCount} active of ${safeEvents.length} events`,
    };
  }

  /* ─── 4. buildWebhookRetryPlan346 ────────────────────────────────────────────*/

  /**
   * Build an exponential-backoff retry plan for failed webhook receipts.
   * Pure — no I/O side effects; callers are responsible for execution.
   *
   * @param {Array}  failedReceipts  Array of V345 webhook receipt objects (ok:false or httpStatus non-2xx)
   * @param {object} [opts]
   * @param {number} [opts.baseDelayMs=30000]      Base backoff delay (default 30 s)
   * @param {number} [opts.maxDelayMs=3600000]     Max delay cap (default 1 h)
   * @param {number} [opts.maxAttempts=5]          Max retry attempts per receipt
   * @param {Date|string} [opts.now]               Reference timestamp
   * @returns {{ ok, retryPlanId, generatedAt, plan, scheduledCount, exhaustedCount, version, summary }}
   */
  function buildWebhookRetryPlan346(failedReceipts, opts) {
    opts = opts || {};
    const baseDelay    = typeof opts.baseDelayMs  === 'number' ? opts.baseDelayMs  : 30_000;
    const maxDelay     = typeof opts.maxDelayMs   === 'number' ? opts.maxDelayMs   : 3_600_000;
    const maxAttempts  = typeof opts.maxAttempts  === 'number' ? opts.maxAttempts  : 5;
    const now          = opts.now ? new Date(opts.now) : new Date();
    const ts           = new Date();
    const planId       = _retryPlanId346(ts);

    const safeReceipts = Array.isArray(failedReceipts) ? failedReceipts : [];

    const plan = safeReceipts.map((receipt, idx) => {
      if (!receipt || typeof receipt !== 'object') {
        return { index: idx, receiptId: null, channelId: null, status: 'invalid', nextAttemptAt: null };
      }
      const receiptId    = receipt.receiptId || `receipt-${idx}`;
      const channelId    = receipt.channelId || null;
      const attemptsDone = typeof receipt.attemptNumber === 'number' ? receipt.attemptNumber : 1;

      if (attemptsDone >= maxAttempts) {
        return {
          index: idx, receiptId, channelId,
          status: 'exhausted', attemptsDone, maxAttempts, nextAttemptAt: null,
          details: `Max attempts (${maxAttempts}) reached`,
        };
      }

      // Exponential backoff: baseDelay * 2^(attemptsDone - 1), capped at maxDelay
      const delayMs  = Math.min(baseDelay * Math.pow(2, attemptsDone - 1), maxDelay);
      const nextAt   = new Date(now.getTime() + delayMs);

      return {
        index: idx, receiptId, channelId,
        status: 'scheduled', attemptsDone, maxAttempts,
        delayMs, nextAttemptAt: nextAt.toISOString(),
        details: `Retry ${attemptsDone + 1}/${maxAttempts} in ${Math.round(delayMs / 1000)}s`,
      };
    });

    const scheduledCount = plan.filter(p => p.status === 'scheduled').length;
    const exhaustedCount = plan.filter(p => p.status === 'exhausted').length;

    return {
      ok: true, retryPlanId: planId, generatedAt: ts.toISOString(),
      plan, scheduledCount, exhaustedCount, totalReceipts: safeReceipts.length,
      version: TIME_SERIES_INTELLIGENCE_VERSION_346,
      summary: `V346 retry plan: ${scheduledCount} scheduled, ${exhaustedCount} exhausted of ${safeReceipts.length} receipts`,
    };
  }

  /* ─── module exports ─────────────────────────────────────────────────────────*/

  module.exports = {
    TIME_SERIES_INTELLIGENCE_VERSION_346,
    detectTimeSeriesAnomalies346,
    buildSlaComplianceReport346,
    buildSuppressionAuditLog346,
    buildWebhookRetryPlan346,
    /* internal helpers exported for testing */
    _anomalyReportId346,
    _hashContent346,
  };
  