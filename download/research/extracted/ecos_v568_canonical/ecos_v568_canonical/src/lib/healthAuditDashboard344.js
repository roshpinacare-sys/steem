'use strict';
  /**
   * lib/healthAuditDashboard344.js — ECOS V344 (Phase P232) — Health Audit Dashboard
   *
   * Closes the V338–V343 automation loop with a live operator dashboard that
   * aggregates compliance snapshots (V343) over time into actionable metrics:
   *
   *   V338 → persist health snapshots
   *   V339 → detect trends + regression alerts
   *   V340 → build + score prioritized remediation plans
   *   V341 → record execution + compare projected vs actual
   *   V342 → define/evaluate health policies + trigger reports
   *   V343 → aggregate all layers → compliance snapshot → score → report → export
   *   V344 → aggregate compliance reports → fleet dashboard → trend → export
   *
   * Four concrete tools:
   *
   *   1. buildDashboardSummary344  — aggregates N compliance snapshots/reports into
   *      a single summary: avg score, score distribution, status counts (COMPLIANT/
   *      MARGINAL/AT_RISK/NON_COMPLIANT), best/worst scores, and temporal range.
   *
   *   2. computeFleetTrend344      — analyses the score series from the summary to
   *      classify the fleet trajectory: 'improving', 'stable', or 'degrading'.
   *      Returns slope, delta, windowSize, and a human-readable reason string.
   *
   *   3. buildAuditDashboard344    — full dashboard payload combining summary, fleet
   *      trend, per-layer breakdown, recommended operator actions, and a readiness
   *      classification (READY / UNDER_REVIEW / BLOCKED).
   *
   *   4. exportAuditDashboard344   — writes the dashboard to a JSON sidecar file.
   *      Idempotent by content hash; dry-run safe. Follows V338–V343 conventions.
   *
   * Pure / dependency-free (R3). All new public identifiers end with `344` (R2).
   * Sacred files (fiatLedger.js, auditLog.js) untouched (R1). Additive only (R6).
   *
   * @version 344.0.0
   */

  const fs     = require('fs');
  const path   = require('path');
  const os     = require('os');
  const crypto = require('crypto');

  const HEALTH_AUDIT_DASHBOARD_VERSION_344 = '344.0.0';

  const DEFAULT_DASHBOARD_EXPORT_DIR_344 = process.env.HEALTH_DASHBOARD_EXPORT_DIR ||
    path.join(os.tmpdir(), 'ecos_health_dashboard');

  /* ─── helpers ─────────────────────────────────────────────────────────────── */

  function _dashboardId344(ts) {
    return 'dashboard_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
  }

  function _hashContent344(str) {
    return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
  }

  function _ensureDir344(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  /** Extract numeric compliance score from a report/snapshot object */
  function _extractScore344(item) {
    if (!item || typeof item !== 'object') return null;
    // V343 compliance report: item.score.numeric
    if (item.score && typeof item.score.numeric === 'number') return item.score.numeric;
    // V343 compliance snapshot: item.scoreResult.score
    if (item.scoreResult && typeof item.scoreResult.score === 'number') return item.scoreResult.score;
    // direct score field
    if (typeof item.score === 'number') return item.score;
    return null;
  }

  /** Extract status label from a report/snapshot object */
  function _extractStatus344(item) {
    if (!item || typeof item !== 'object') return 'UNKNOWN';
    if (item.score && typeof item.score.status === 'string') return item.score.status;
    if (item.scoreResult && typeof item.scoreResult.status === 'string') return item.scoreResult.status;
    if (typeof item.status === 'string') return item.status;
    return 'UNKNOWN';
  }

  /** Extract capturedAt timestamp from a report/snapshot object */
  function _extractTimestamp344(item) {
    if (!item || typeof item !== 'object') return null;
    if (typeof item.capturedAt === 'string') return item.capturedAt;
    if (typeof item.generatedAt === 'string') return item.generatedAt;
    if (typeof item.timestamp === 'string') return item.timestamp;
    return null;
  }

  /** Compute simple linear regression slope for a numeric array */
  function _slope344(arr) {
    if (!arr || arr.length < 2) return 0;
    const n   = arr.length;
    const xs  = arr.map((_, i) => i);
    const sumX  = xs.reduce((a, b) => a + b, 0);
    const sumY  = arr.reduce((a, b) => a + b, 0);
    const sumXY = xs.reduce((s, x, i) => s + x * arr[i], 0);
    const sumX2 = xs.reduce((s, x) => s + x * x, 0);
    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return 0;
    return (n * sumXY - sumX * sumY) / denom;
  }

  /* ─── 1. buildDashboardSummary344 ────────────────────────────────────────────*/

  /**
   * Aggregate N compliance reports or snapshots into a single summary object.
   *
   * @param {Array<object>} items   Array of V343 compliance reports or snapshots
   * @param {object}        [opts]
   * @param {string}        [opts.label]  Optional descriptive label
   * @returns {{ ok, totalItems, avgScore, minScore, maxScore, scoreDistribution,
   *             statusCounts, scoreSeries, temporalRange, label, version }}
   */
  function buildDashboardSummary344(items, opts) {
    opts  = opts || {};
    const label = typeof opts.label === 'string' ? opts.label : 'fleet';

    const safeItems = Array.isArray(items) ? items : [];

    if (safeItems.length === 0) {
      return {
        ok: true, totalItems: 0, avgScore: null, minScore: null, maxScore: null,
        scoreDistribution: { A: 0, B: 0, C: 0, D: 0, F: 0 },
        statusCounts: { COMPLIANT: 0, MARGINAL: 0, AT_RISK: 0, NON_COMPLIANT: 0, UNKNOWN: 0 },
        scoreSeries: [], temporalRange: { earliest: null, latest: null },
        label, version: HEALTH_AUDIT_DASHBOARD_VERSION_344,
        summary: 'V344 dashboard summary: no items provided',
      };
    }

    const scores   = safeItems.map(_extractScore344).filter(s => s !== null);
    const statuses = safeItems.map(_extractStatus344);
    const timestamps = safeItems.map(_extractTimestamp344).filter(Boolean).sort();

    const avgScore = scores.length > 0
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
      : null;
    const minScore = scores.length > 0 ? Math.min(...scores) : null;
    const maxScore = scores.length > 0 ? Math.max(...scores) : null;

    const scoreDistribution = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    for (const s of scores) {
      if (s >= 90)      scoreDistribution.A++;
      else if (s >= 80) scoreDistribution.B++;
      else if (s >= 70) scoreDistribution.C++;
      else if (s >= 60) scoreDistribution.D++;
      else              scoreDistribution.F++;
    }

    const statusCounts = { COMPLIANT: 0, MARGINAL: 0, AT_RISK: 0, NON_COMPLIANT: 0, UNKNOWN: 0 };
    for (const st of statuses) {
      if (st in statusCounts) statusCounts[st]++;
      else                    statusCounts.UNKNOWN++;
    }

    const scoreSeries = safeItems.map((item, i) => ({
      index: i,
      score: _extractScore344(item),
      status: _extractStatus344(item),
      timestamp: _extractTimestamp344(item),
    }));

    return {
      ok: true,
      totalItems: safeItems.length,
      avgScore,
      minScore,
      maxScore,
      scoreDistribution,
      statusCounts,
      scoreSeries,
      temporalRange: {
        earliest: timestamps[0]             || null,
        latest:   timestamps[timestamps.length - 1] || null,
      },
      label,
      version: HEALTH_AUDIT_DASHBOARD_VERSION_344,
      summary: `V344 dashboard summary: ${safeItems.length} items, avg score ${avgScore ?? 'N/A'}`,
    };
  }

  /* ─── 2. computeFleetTrend344 ────────────────────────────────────────────────*/

  /**
   * Classify the fleet score trajectory from a dashboard summary.
   *
   * @param {object} dashboardSummary  Output of buildDashboardSummary344
   * @param {object} [opts]
   * @param {number} [opts.stableThreshold=1.5]  Slope abs-value below which trend is 'stable'
   * @returns {{ ok, direction, slope, delta, windowSize, reason, version }}
   */
  function computeFleetTrend344(dashboardSummary, opts) {
    opts = opts || {};
    const stableThreshold = typeof opts.stableThreshold === 'number' ? opts.stableThreshold : 1.5;

    if (!dashboardSummary || !Array.isArray(dashboardSummary.scoreSeries) ||
        dashboardSummary.scoreSeries.length === 0) {
      return {
        ok: false, direction: 'unknown', slope: 0, delta: 0, windowSize: 0,
        reason: 'V344 fleet trend: no score series in summary',
        version: HEALTH_AUDIT_DASHBOARD_VERSION_344,
      };
    }

    const series = dashboardSummary.scoreSeries.map(s => s.score).filter(s => s !== null);
    if (series.length < 2) {
      return {
        ok: true, direction: 'stable', slope: 0, delta: 0, windowSize: series.length,
        reason: 'V344 fleet trend: insufficient data points for trend analysis',
        version: HEALTH_AUDIT_DASHBOARD_VERSION_344,
      };
    }

    const slope = _slope344(series);
    const delta = series[series.length - 1] - series[0];
    let direction, reason;

    if (Math.abs(slope) < stableThreshold) {
      direction = 'stable';
      reason    = `Slope ${slope.toFixed(2)} within stable band ±${stableThreshold}`;
    } else if (slope > 0) {
      direction = 'improving';
      reason    = `Positive slope ${slope.toFixed(2)} — fleet scores rising`;
    } else {
      direction = 'degrading';
      reason    = `Negative slope ${slope.toFixed(2)} — fleet scores falling`;
    }

    return {
      ok: true, direction, slope: Math.round(slope * 1000) / 1000,
      delta: Math.round(delta * 10) / 10,
      windowSize: series.length,
      reason, version: HEALTH_AUDIT_DASHBOARD_VERSION_344,
    };
  }

  /* ─── 3. buildAuditDashboard344 ──────────────────────────────────────────────*/

  /** Derive recommended operator actions from summary + trend */
  function _recommendations344(summary, trend) {
    const recs = [];
    const { statusCounts, avgScore } = summary;
    const { direction } = trend;

    if ((statusCounts.NON_COMPLIANT || 0) > 0)
      recs.push({ priority: 1, action: 'remediate-non-compliant',
        detail: `${statusCounts.NON_COMPLIANT} NON_COMPLIANT snapshot(s) require immediate attention` });
    if ((statusCounts.AT_RISK || 0) > 0)
      recs.push({ priority: 2, action: 'review-at-risk',
        detail: `${statusCounts.AT_RISK} AT_RISK snapshot(s) need review before next release` });
    if (direction === 'degrading')
      recs.push({ priority: 3, action: 'investigate-degradation',
        detail: `Fleet trend is degrading (slope ${trend.slope}) — run consolidation sweep` });
    if (avgScore !== null && avgScore < 70)
      recs.push({ priority: 4, action: 'policy-review',
        detail: `Average fleet score ${avgScore} is below the 70-point MARGINAL threshold` });
    if (recs.length === 0)
      recs.push({ priority: 5, action: 'no-action', detail: 'Fleet is healthy — no immediate action required' });

    return recs.sort((a, b) => a.priority - b.priority);
  }

  /** Derive readiness classification from summary */
  function _readiness344(summary) {
    const nc = summary.statusCounts.NON_COMPLIANT || 0;
    const ar = summary.statusCounts.AT_RISK       || 0;
    if (nc > 0)                   return 'BLOCKED';
    if (ar > 0 || summary.avgScore !== null && summary.avgScore < 70)
                                  return 'UNDER_REVIEW';
    return 'READY';
  }

  /**
   * Build the full audit dashboard payload.
   *
   * @param {Array<object>} complianceReports   V343 compliance reports or snapshots
   * @param {object}        [opts]
   * @param {string}        [opts.label]
   * @param {number}        [opts.stableThreshold]
   * @returns {{ ok, dashboardId, generatedAt, summary, trend, recommendations,
   *             readiness, version }}
   */
  function buildAuditDashboard344(complianceReports, opts) {
    opts = opts || {};
    const ts          = new Date();
    const dashboardId = _dashboardId344(ts);

    const summary = buildDashboardSummary344(complianceReports, { label: opts.label });
    const trend   = computeFleetTrend344(summary, { stableThreshold: opts.stableThreshold });
    const recommendations = _recommendations344(summary, trend);
    const readiness       = _readiness344(summary);

    return {
      ok: true,
      dashboardId,
      generatedAt: ts.toISOString(),
      summary,
      trend,
      recommendations,
      readiness,
      version: HEALTH_AUDIT_DASHBOARD_VERSION_344,
      statusSummary: `V344 audit dashboard [${dashboardId}]: ${summary.totalItems} reports, ${trend.direction}, readiness=${readiness}`,
    };
  }

  /* ─── 4. exportAuditDashboard344 ─────────────────────────────────────────────*/

  /**
   * Write the dashboard payload to a JSON sidecar file.
   * Idempotent by content hash. dry-run safe (default dryRun=true).
   *
   * @param {object} dashboard  Output of buildAuditDashboard344
   * @param {object} [opts]
   * @param {string} [opts.exportDir]
   * @param {boolean}[opts.dryRun]     default true
   * @returns {{ ok, filePath, written, skipped, dryRun, contentHash, version }}
   */
  function exportAuditDashboard344(dashboard, opts) {
    opts    = opts    || {};
    const dryRun    = opts.dryRun !== false;
    const exportDir = typeof opts.exportDir === 'string' ? opts.exportDir : DEFAULT_DASHBOARD_EXPORT_DIR_344;

    if (!dashboard || typeof dashboard !== 'object' || !dashboard.dashboardId) {
      return {
        ok: false, filePath: null, written: false, skipped: false,
        dryRun, contentHash: null,
        version: HEALTH_AUDIT_DASHBOARD_VERSION_344,
        summary: 'V344 export: invalid dashboard object (missing dashboardId)',
      };
    }

    const content     = JSON.stringify(dashboard, null, 2);
    const contentHash = _hashContent344(content);
    const fileName    = dashboard.dashboardId + '_' + contentHash + '.json';
    const filePath    = path.join(exportDir, fileName);

    if (dryRun) {
      return {
        ok: true, filePath, written: false, skipped: false,
        dryRun: true, contentHash,
        version: HEALTH_AUDIT_DASHBOARD_VERSION_344,
        summary: `V344 export (dry-run): would write ${filePath}`,
      };
    }

    try {
      _ensureDir344(exportDir);
      if (fs.existsSync(filePath)) {
        const existing = fs.readFileSync(filePath, 'utf8');
        if (_hashContent344(existing) === contentHash) {
          return {
            ok: true, filePath, written: false, skipped: true,
            dryRun: false, contentHash,
            version: HEALTH_AUDIT_DASHBOARD_VERSION_344,
            summary: `V344 export: skipped (identical content) ${filePath}`,
          };
        }
      }
      fs.writeFileSync(filePath, content, 'utf8');
      return {
        ok: true, filePath, written: true, skipped: false,
        dryRun: false, contentHash,
        version: HEALTH_AUDIT_DASHBOARD_VERSION_344,
        summary: `V344 export: written ${filePath}`,
      };
    } catch (err) {
      return {
        ok: false, filePath, written: false, skipped: false,
        dryRun: false, contentHash, error: err.message,
        version: HEALTH_AUDIT_DASHBOARD_VERSION_344,
        summary: `V344 export: FAILED — ${err.message}`,
      };
    }
  }

  /* ─── module exports ─────────────────────────────────────────────────────────*/

  module.exports = {
    HEALTH_AUDIT_DASHBOARD_VERSION_344,
    buildDashboardSummary344,
    computeFleetTrend344,
    buildAuditDashboard344,
    exportAuditDashboard344,
    /* internal helpers exported for testing */
    _dashboardId344,
    _hashContent344,
  };
  