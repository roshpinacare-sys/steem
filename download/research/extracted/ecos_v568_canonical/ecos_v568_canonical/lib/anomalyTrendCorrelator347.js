'use strict';
  /**
   * lib/anomalyTrendCorrelator347.js — ECOS V347 (Phase P235)
   * Anomaly Trend Correlator
   *
   * Extends V346 Time-Series Intelligence Engine with four correlation and
   * forecasting tools:
   *
   *   V346 → anomaly detection, SLA compliance, suppression audit, webhook retry
   *   V347 → anomaly trend correlation, SLA forecasting, suppression overlap
   *           detection, webhook channel health monitoring
   *
   * Four concrete tools:
   *
   *   1. correlateAnomalyTrends347  — takes multiple V346 anomaly reports over
   *      time, identifies recurring anomaly patterns (same period/type), and
   *      computes a recurrence score per anomaly. Distinguishes transient spikes
   *      from structural regressions.
   *
   *   2. forecastSlaCompliance347   — uses the existing score series from a V345
   *      timeSeries to project future compliance probability for the next N periods
   *      via linear extrapolation. Returns per-SLA predicted pass/fail with
   *      confidence bounds.
   *
   *   3. detectSuppressionOverlaps347 — scans all rules in a V345 suppression
   *      registry for overlapping windows (same scope, overlapping time range)
   *      and flags redundant or conflicting rules.
   *
   *   4. buildWebhookChannelHealth347 — aggregates V345 receipt history per
   *      channel, computes per-channel delivery success rate, p50/p95 response
   *      time proxies (from receipt timestamps), and flags channels below a
   *      configurable health threshold.
   *
   * Pure / dependency-free (R3). All new public identifiers end with `347` (R2).
   * Sacred files (fiatLedger.js, auditLog.js) untouched (R1). Additive only (R6).
   *
   * @version 347.0.0
   */

  const crypto = require('crypto');

  const ANOMALY_TREND_CORRELATOR_VERSION_347 = '347.0.0';

  /* ─── internal helpers ────────────────────────────────────────────────────── */

  function _correlationId347(ts) {
    return 'correlation_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
  }

  function _forecastId347(ts) {
    return 'forecast_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
  }

  function _overlapId347(ts) {
    return 'overlap_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
  }

  function _channelHealthId347(ts) {
    return 'channel_health_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
  }

  function _hashContent347(str) {
    return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
  }

  /** Simple linear regression over [index, value] pairs — returns { slope, intercept } */
  function _linearRegression347(values) {
    const n = values.length;
    if (n < 2) return { slope: 0, intercept: values.length ? values[0] : 0 };
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
      sumX  += i;
      sumY  += values[i];
      sumXY += i * values[i];
      sumX2 += i * i;
    }
    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return { slope: 0, intercept: sumY / n };
    const slope     = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;
    return { slope, intercept };
  }

  /* ─── 1. correlateAnomalyTrends347 ──────────────────────────────────────────*/

  /**
   * Correlate anomaly patterns across multiple V346 anomaly reports to identify
   * recurring structural regressions vs transient noise.
   *
   * @param {object[]} anomalyReports  Array of V346 detectTimeSeriesAnomalies346 results
   * @param {object}   [opts]
   * @param {number}   [opts.recurrenceThreshold=2]  Min occurrences to mark as recurring
   * @param {string}   [opts.label]
   * @returns {{ ok, correlationId, generatedAt, correlations, recurringCount,
   *             transientCount, totalAnomalies, summary, version }}
   */
  function correlateAnomalyTrends347(anomalyReports, opts) {
    opts = opts || {};
    const recurrenceThreshold = typeof opts.recurrenceThreshold === 'number'
      ? opts.recurrenceThreshold : 2;
    const label = typeof opts.label === 'string' ? opts.label : 'fleet';
    const ts    = new Date();
    const id    = _correlationId347(ts);

    if (!Array.isArray(anomalyReports) || anomalyReports.length === 0) {
      return {
        ok: true, correlationId: id, generatedAt: ts.toISOString(),
        correlations: [], recurringCount: 0, transientCount: 0,
        totalAnomalies: 0, label,
        version: ANOMALY_TREND_CORRELATOR_VERSION_347,
        summary: 'V347 correlate: no anomaly reports provided',
      };
    }

    // Collect all anomalies across all reports, keyed by type
    const byType = {};  // type → [{ period, reportIndex, zScore, avgScore }]
    let totalAnomalies = 0;

    anomalyReports.forEach((report, ri) => {
      const anomalies = (report && Array.isArray(report.anomalies)) ? report.anomalies : [];
      anomalies.forEach(a => {
        const key = a.type || 'unknown';
        if (!byType[key]) byType[key] = [];
        byType[key].push({
          period:      a.period,
          reportIndex: ri,
          zScore:      typeof a.zScore === 'number' ? a.zScore : null,
          avgScore:    typeof a.avgScore === 'number' ? a.avgScore : null,
          details:     a.details || '',
        });
        totalAnomalies++;
      });
    });

    const correlations = [];
    let recurringCount = 0;
    let transientCount = 0;

    for (const [type, occurrences] of Object.entries(byType)) {
      const count           = occurrences.length;
      const isRecurring     = count >= recurrenceThreshold;
      const recurrenceScore = Math.min(100, Math.round((count / anomalyReports.length) * 100));
      const avgZ = occurrences
        .filter(o => o.zScore !== null)
        .reduce((s, o, _, a) => s + o.zScore / a.length, 0);
      const periodSet = [...new Set(occurrences.map(o => o.period).filter(Boolean))];

      correlations.push({
        type,
        occurrenceCount:  count,
        recurrenceScore,
        isRecurring,
        classification:   isRecurring ? 'structural' : 'transient',
        avgZScore:        isNaN(avgZ) ? null : Math.round(avgZ * 100) / 100,
        affectedPeriods:  periodSet,
        reportsAffected:  [...new Set(occurrences.map(o => o.reportIndex))].length,
        details: isRecurring
          ? `Anomaly type '${type}' recurring in ${count} reports — structural regression likely`
          : `Anomaly type '${type}' seen ${count} time(s) — likely transient`,
      });

      if (isRecurring) recurringCount++;
      else transientCount++;
    }

    // Sort by recurrence score descending
    correlations.sort((a, b) => b.recurrenceScore - a.recurrenceScore);

    return {
      ok: true, correlationId: id, generatedAt: ts.toISOString(),
      correlations, recurringCount, transientCount,
      totalAnomalies, totalReports: anomalyReports.length, label,
      version: ANOMALY_TREND_CORRELATOR_VERSION_347,
      summary: `V347 correlate: ${totalAnomalies} anomalies across ${anomalyReports.length} reports — ${recurringCount} structural, ${transientCount} transient`,
    };
  }

  /* ─── 2. forecastSlaCompliance347 ────────────────────────────────────────────*/

  /**
   * Forecast SLA compliance for the next N periods using linear extrapolation
   * over the existing V345 time-series score data.
   *
   * @param {object}   timeSeries   Output of buildDashboardTimeSeries345
   * @param {object[]} slaTargets   [{ id, name, minScore, requiredCompliance }]
   * @param {object}   [opts]
   * @param {number}   [opts.forecastPeriods=5]  Number of future periods to project
   * @param {number}   [opts.minHistoryPeriods=3] Min historical periods required
   * @returns {{ ok, forecastId, generatedAt, forecasts, overallOutlook, version, summary }}
   */
  function forecastSlaCompliance347(timeSeries, slaTargets, opts) {
    opts = opts || {};
    const forecastPeriods    = typeof opts.forecastPeriods    === 'number' ? opts.forecastPeriods    : 5;
    const minHistoryPeriods  = typeof opts.minHistoryPeriods  === 'number' ? opts.minHistoryPeriods  : 3;
    const ts = new Date();
    const id = _forecastId347(ts);

    const periods = (timeSeries && Array.isArray(timeSeries.periods)) ? timeSeries.periods : [];

    if (periods.length < minHistoryPeriods) {
      return {
        ok: true, forecastId: id, generatedAt: ts.toISOString(),
        forecasts: [], overallOutlook: 'insufficient_data',
        totalHistoricalPeriods: periods.length,
        version: ANOMALY_TREND_CORRELATOR_VERSION_347,
        summary: `V347 forecast: insufficient history (${periods.length} periods, need ≥${minHistoryPeriods})`,
      };
    }

    const targets = Array.isArray(slaTargets) ? slaTargets : [];
    const scores  = periods.map(p => typeof p.avgScore === 'number' ? p.avgScore : null)
                           .filter(s => s !== null);
    const { slope, intercept } = _linearRegression347(scores);

    // Project N future scores
    const lastIdx = scores.length - 1;
    const projectedScores = [];
    for (let i = 1; i <= forecastPeriods; i++) {
      const projected = intercept + slope * (lastIdx + i);
      projectedScores.push(Math.max(0, Math.min(100, Math.round(projected * 10) / 10)));
    }

    const trendDirection = slope > 0.5 ? 'improving' : slope < -0.5 ? 'degrading' : 'stable';

    const forecasts = targets.map(target => {
      const { id: tid, name, minScore, requiredCompliance } = target;
      const minS  = typeof minScore          === 'number' ? minScore          : 80;
      const reqC  = typeof requiredCompliance === 'number' ? requiredCompliance : 0.9;

      // Compliance on historical data
      const historicalPassing    = scores.filter(s => s >= minS).length;
      const historicalCompliance = Math.round((historicalPassing / scores.length) * 100) / 100;

      // Projected compliance over forecast window
      const projPassing    = projectedScores.filter(s => s >= minS).length;
      const projCompliance = Math.round((projPassing / forecastPeriods) * 100) / 100;

      const projectedPass     = projCompliance >= reqC;
      const confidenceDelta   = Math.abs(projCompliance - reqC);
      const confidence        = confidenceDelta > 0.3 ? 'high' : confidenceDelta > 0.1 ? 'medium' : 'low';

      return {
        id: tid, name,
        minScore: minS, requiredCompliance: reqC,
        historicalCompliance, historicalPassing, historicalTotal: scores.length,
        projectedCompliance, projectedPass, projectedScores,
        confidence,
        trendDirection,
        projectedPeriods: forecastPeriods,
        details: projectedPass
          ? `Forecast PASS: projected compliance ${Math.round(projCompliance * 100)}% ≥ required ${Math.round(reqC * 100)}% over next ${forecastPeriods} periods`
          : `Forecast FAIL: projected compliance ${Math.round(projCompliance * 100)}% < required ${Math.round(reqC * 100)}% over next ${forecastPeriods} periods`,
      };
    });

    const passCount = forecasts.filter(f => f.projectedPass).length;
    const overallOutlook = passCount === forecasts.length ? 'on_track'
      : passCount === 0 ? 'at_risk' : 'partial_risk';

    return {
      ok: true, forecastId: id, generatedAt: ts.toISOString(),
      forecasts, passCount, failCount: forecasts.length - passCount,
      totalSlaTargets: forecasts.length, overallOutlook,
      trendDirection, slope: Math.round(slope * 1000) / 1000,
      projectedScores, totalHistoricalPeriods: periods.length,
      version: ANOMALY_TREND_CORRELATOR_VERSION_347,
      summary: `V347 forecast: ${passCount}/${forecasts.length} SLAs on track over next ${forecastPeriods} periods, trend=${trendDirection}`,
    };
  }

  /* ─── 3. detectSuppressionOverlaps347 ───────────────────────────────────────*/

  /**
   * Scan all rules in a V345 suppression registry for overlapping windows
   * (same scope and overlapping time ranges). Flags redundant or conflicting rules.
   *
   * @param {object}  registry  Output of buildAlertSuppressionRegistry345
   * @param {object}  [opts]
   * @param {boolean} [opts.includeInactive=false]  Include inactive rules in scan
   * @returns {{ ok, overlapId, generatedAt, overlaps, overlapCount, redundantCount,
   *             conflictCount, totalRulesScanned, version, summary }}
   */
  function detectSuppressionOverlaps347(registry, opts) {
    opts = opts || {};
    const includeInactive = !!opts.includeInactive;
    const ts = new Date();
    const id = _overlapId347(ts);

    const allRules = (registry && Array.isArray(registry.rules)) ? registry.rules
      : (registry && Array.isArray(registry.activeRules)) ? [
          ...(registry.activeRules || []),
          ...(registry.inactiveRules || []),
        ]
      : [];

    const rules = includeInactive ? allRules : allRules.filter(r => r.enabled !== false);

    if (rules.length < 2) {
      return {
        ok: true, overlapId: id, generatedAt: ts.toISOString(),
        overlaps: [], overlapCount: 0, redundantCount: 0, conflictCount: 0,
        totalRulesScanned: rules.length,
        version: ANOMALY_TREND_CORRELATOR_VERSION_347,
        summary: `V347 overlap: fewer than 2 rules — no overlaps possible`,
      };
    }

    // Build time ranges
    const ruleMeta = rules.map(r => ({
      name:    r.name || 'unnamed',
      scope:   r.scope || 'global',
      startsAt: r.startsAt ? new Date(r.startsAt).getTime() : null,
      endsAt:   r.endsAt   ? new Date(r.endsAt).getTime()   : null,
      enabled:  r.enabled !== false,
      raw:      r,
    }));

    const overlaps = [];
    let redundantCount = 0;
    let conflictCount  = 0;

    for (let i = 0; i < ruleMeta.length; i++) {
      for (let j = i + 1; j < ruleMeta.length; j++) {
        const a = ruleMeta[i];
        const b = ruleMeta[j];

        // Scope must match (or one is global)
        const scopeMatch = a.scope === b.scope || a.scope === 'global' || b.scope === 'global';
        if (!scopeMatch) continue;

        // Both must have time ranges
        if (a.startsAt === null || b.startsAt === null) continue;

        const aEnd = a.endsAt   || Infinity;
        const bEnd = b.endsAt   || Infinity;

        // Check overlap: [a.start, a.end] ∩ [b.start, b.end] non-empty
        const overlapStart = Math.max(a.startsAt, b.startsAt);
        const overlapEnd   = Math.min(aEnd, bEnd);

        if (overlapStart < overlapEnd) {
          // Determine if redundant (one contains the other) or conflicting (partial)
          const aContainsB = a.startsAt <= b.startsAt && aEnd >= bEnd;
          const bContainsA = b.startsAt <= a.startsAt && bEnd >= aEnd;
          const kind = (aContainsB || bContainsA) ? 'redundant' : 'conflict';

          if (kind === 'redundant') redundantCount++;
          else conflictCount++;

          const overlapMs = isFinite(overlapEnd) ? overlapEnd - overlapStart : -1;

          overlaps.push({
            ruleA: a.name, ruleB: b.name,
            scopeA: a.scope, scopeB: b.scope,
            kind,
            overlapStartAt: new Date(overlapStart).toISOString(),
            overlapEndAt:   isFinite(overlapEnd) ? new Date(overlapEnd).toISOString() : null,
            overlapMs:      isFinite(overlapMs) ? overlapMs : null,
            details: kind === 'redundant'
              ? `Rule '${aContainsB ? a.name : b.name}' fully contains '${aContainsB ? b.name : a.name}' — one is redundant`
              : `Rules '${a.name}' and '${b.name}' overlap partially — potential conflict`,
          });
        }
      }
    }

    return {
      ok: true, overlapId: id, generatedAt: ts.toISOString(),
      overlaps, overlapCount: overlaps.length, redundantCount, conflictCount,
      totalRulesScanned: rules.length,
      version: ANOMALY_TREND_CORRELATOR_VERSION_347,
      summary: `V347 overlap: ${overlaps.length} overlaps found in ${rules.length} rules (${redundantCount} redundant, ${conflictCount} conflicts)`,
    };
  }

  /* ─── 4. buildWebhookChannelHealth347 ────────────────────────────────────────*/

  /**
   * Aggregate V345 webhook receipt history per channel to compute delivery health.
   * Returns per-channel success rate, timing proxies, and health classification.
   *
   * @param {object[]} receipts  Array of V345 webhook receipt objects
   * @param {object}   [opts]
   * @param {number}   [opts.healthThreshold=0.8]  Success rate below which channel is unhealthy
   * @param {number}   [opts.warningThreshold=0.95] Success rate below which channel is warned
   * @returns {{ ok, channelHealthId, generatedAt, channels, healthyCount,
   *             unhealthyCount, warnCount, totalChannels, overallHealth, version, summary }}
   */
  function buildWebhookChannelHealth347(receipts, opts) {
    opts = opts || {};
    const healthThreshold  = typeof opts.healthThreshold  === 'number' ? opts.healthThreshold  : 0.8;
    const warningThreshold = typeof opts.warningThreshold === 'number' ? opts.warningThreshold : 0.95;
    const ts = new Date();
    const id = _channelHealthId347(ts);

    if (!Array.isArray(receipts) || receipts.length === 0) {
      return {
        ok: true, channelHealthId: id, generatedAt: ts.toISOString(),
        channels: [], healthyCount: 0, unhealthyCount: 0, warnCount: 0,
        totalChannels: 0, overallHealth: 'no_data',
        version: ANOMALY_TREND_CORRELATOR_VERSION_347,
        summary: 'V347 channel-health: no receipts provided',
      };
    }

    // Group by channelId
    const byChannel = {};
    for (const r of receipts) {
      const ch = r.channelId || 'unknown';
      if (!byChannel[ch]) byChannel[ch] = [];
      byChannel[ch].push(r);
    }

    const channels = [];
    let healthyCount = 0, unhealthyCount = 0, warnCount = 0;

    for (const [channelId, recs] of Object.entries(byChannel)) {
      const total      = recs.length;
      const successful = recs.filter(r => r.ok === true || (r.httpStatus >= 200 && r.httpStatus < 300)).length;
      const failed     = total - successful;
      const successRate = Math.round((successful / total) * 1000) / 1000;

      // Compute p50/p95 proxies from attemptNumber (proxy for delivery cost)
      const attempts = recs.map(r => typeof r.attemptNumber === 'number' ? r.attemptNumber : 1).sort((a, b) => a - b);
      const p50Idx   = Math.floor(attempts.length * 0.5);
      const p95Idx   = Math.floor(attempts.length * 0.95);
      const p50Attempts = attempts[p50Idx] || 1;
      const p95Attempts = attempts[Math.min(p95Idx, attempts.length - 1)] || 1;

      // HTTP status distribution
      const statusDist = {};
      for (const r of recs) {
        const s = r.httpStatus || (r.ok ? 200 : 500);
        statusDist[s] = (statusDist[s] || 0) + 1;
      }

      let status;
      if (successRate < healthThreshold)  { status = 'unhealthy'; unhealthyCount++; }
      else if (successRate < warningThreshold) { status = 'warn'; warnCount++; }
      else { status = 'healthy'; healthyCount++; }

      channels.push({
        channelId, total, successful, failed, successRate, status,
        p50Attempts, p95Attempts, statusDistribution: statusDist,
        details: `Channel '${channelId}': ${Math.round(successRate * 100)}% success rate over ${total} receipts — ${status}`,
      });
    }

    // Sort: unhealthy → warn → healthy
    const statusOrder = { unhealthy: 0, warn: 1, healthy: 2 };
    channels.sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || a.successRate - b.successRate);

    const overallHealth = unhealthyCount > 0 ? 'degraded'
      : warnCount > 0 ? 'partial'
      : 'healthy';

    return {
      ok: true, channelHealthId: id, generatedAt: ts.toISOString(),
      channels, healthyCount, unhealthyCount, warnCount,
      totalChannels: channels.length, overallHealth,
      version: ANOMALY_TREND_CORRELATOR_VERSION_347,
      summary: `V347 channel-health: ${channels.length} channels — ${healthyCount} healthy, ${warnCount} warn, ${unhealthyCount} unhealthy, overall=${overallHealth}`,
    };
  }

  /* ─── exports ─────────────────────────────────────────────────────────────── */

  if (typeof module !== 'undefined') {
    module.exports = {
      ANOMALY_TREND_CORRELATOR_VERSION_347,
      correlateAnomalyTrends347,
      forecastSlaCompliance347,
      detectSuppressionOverlaps347,
      buildWebhookChannelHealth347,
      _correlationId347,
      _forecastId347,
      _overlapId347,
      _channelHealthId347,
      _hashContent347,
      _linearRegression347,
    };
  }
  