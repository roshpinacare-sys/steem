'use strict';
/**
 * lib/healthTrendAnalyzer339.js — ECOS V339 (Phase P227) — Health Trend Analysis
 *
 * Builds on V338's durable snapshot store to provide trend analysis across a
 * sliding window of health history snapshots. Four concrete advances:
 *
 *   1. analyzeHealthTrend339   — processes an array of health snapshots to compute
 *      per-family trend direction (improving / degrading / stable / volatile) and
 *      a slope estimate (linear regression over scores).
 *
 *   2. detectRegressionAlerts339 — scans trend data for families showing consistent
 *      score decline or tier regression over the window; returns actionable alerts
 *      classified by severity (critical / warning / info).
 *
 *   3. buildTrendReport339     — full pipeline: accepts a loadHealthHistory338-style
 *      history object, computes trends + alerts, and returns a complete trend report
 *      with window stats, per-family trends, and alerts array.
 *
 *   4. exportTrendSummary339   — serializes a buildTrendReport339 result to a JSON
 *      file (dry-run safe, idempotent by content hash, same conventions as
 *      persistHealthReport338).
 *
 * Pure / dependency-free (R6); all new public identifiers end with `339` (R2).
 * Sacred files (fiatLedger.js, auditLog.js) untouched (R1). No new npm deps (R3).
 *
 * @version 339.0.0
 */

const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');

const HEALTH_TREND_VERSION_339 = '339.0.0';

const DEFAULT_TREND_DIR_339 = process.env.HEALTH_TREND_DIR ||
  path.join(os.tmpdir(), 'ecos_health_trends');

/* ─── helpers ─────────────────────────────────────────────────────────────── */

/** Linear regression slope over an array of numbers. Returns null when n < 2. */
function _slope339(values) {
  const n = values.length;
  if (n < 2) return null;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX  += i;
    sumY  += values[i];
    sumXY += i * values[i];
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

function _hashTrend339(str) {
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

function _ensureDir339(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function _trendId339(ts) {
  return 'trend_' + ts.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

/* ─── 1. analyzeHealthTrend339 ────────────────────────────────────────────── */

/**
 * Compute per-family trend direction from an ordered array of health snapshots.
 * Snapshots must be in chronological order (oldest first).
 *
 * Direction classification (based on linear slope of score over the window):
 *   - 'improving'  slope >= +1.0 / window unit
 *   - 'degrading'  slope <= -1.0 / window unit
 *   - 'volatile'   std-dev of scores > 10 and |slope| < 1.0
 *   - 'stable'     otherwise
 *
 * @param {object[]} snapshots   Array from loadHealthHistory338 result (snapshots[])
 * @param {object}   [opts]
 * @param {number}   [opts.slopeThreshold=1.0]  Min |slope| to classify as improving/degrading
 * @param {number}   [opts.volatileStdDev=10]   Std-dev threshold for volatile classification
 * @returns {{ ok, families[], totalFamilies, windowSize, summary, version }}
 */
function analyzeHealthTrend339(snapshots, opts) {
  opts = opts || {};
  const slopeThreshold = typeof opts.slopeThreshold === 'number' ? opts.slopeThreshold : 1.0;
  const volatileStdDev = typeof opts.volatileStdDev  === 'number' ? opts.volatileStdDev  : 10;

  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return {
      ok: false, error: 'snapshots must be a non-empty array',
      families: [], totalFamilies: 0, windowSize: 0,
      summary: 'V339 trend analysis: no snapshots provided',
      version: HEALTH_TREND_VERSION_339,
    };
  }

  // Collect score series per family across snapshots
  const seriesMap = new Map(); // base -> { scores[], tiers[] }
  for (const snap of snapshots) {
    const families = (snap.report && snap.report.families)
      ? snap.report.families
      : (snap.families || []);
    for (const f of families) {
      if (!seriesMap.has(f.base)) seriesMap.set(f.base, { scores: [], tiers: [] });
      const entry = seriesMap.get(f.base);
      entry.scores.push(typeof f.score === 'number' ? f.score : 0);
      entry.tiers.push(f.tier || 'unknown');
    }
  }

  const families = [];
  for (const [base, series] of seriesMap.entries()) {
    const scores   = series.scores;
    const tiers    = series.tiers;
    const slope    = _slope339(scores);
    const n        = scores.length;
    const mean     = scores.reduce((a, b) => a + b, 0) / n;
    const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const stdDev   = Math.sqrt(variance);

    let direction;
    if      (slope !== null && slope >= slopeThreshold)  direction = 'improving';
    else if (slope !== null && slope <= -slopeThreshold) direction = 'degrading';
    else if (stdDev > volatileStdDev)                    direction = 'volatile';
    else                                                 direction = 'stable';

    const latestScore = scores[scores.length - 1];
    const firstScore  = scores[0];
    const netChange   = Math.round((latestScore - firstScore) * 100) / 100;
    const latestTier  = tiers[tiers.length - 1];
    const firstTier   = tiers[0];

    // Tier regressions: count how many tier-drops occurred across consecutive snapshots
    let tierRegressions = 0;
    const TIER_RANK = { healthy: 2, watch: 1, critical: 0, unknown: -1 };
    for (let i = 1; i < tiers.length; i++) {
      if ((TIER_RANK[tiers[i]] ?? -1) < (TIER_RANK[tiers[i - 1]] ?? -1)) tierRegressions++;
    }

    families.push({
      base,
      direction,
      slope:          slope !== null ? Math.round(slope * 1000) / 1000 : null,
      stdDev:         Math.round(stdDev * 100) / 100,
      mean:           Math.round(mean * 100) / 100,
      netChange,
      dataPoints:     n,
      firstScore, latestScore,
      firstTier,  latestTier,
      tierRegressions,
      scores,
    });
  }

  // Sort: most at-risk first (degrading → volatile → stable → improving)
  const ORDER = { degrading: 0, volatile: 1, stable: 2, improving: 3 };
  families.sort((a, b) => (ORDER[a.direction] ?? 4) - (ORDER[b.direction] ?? 4));

  const improvingCount = families.filter(f => f.direction === 'improving').length;
  const degradingCount = families.filter(f => f.direction === 'degrading').length;
  const volatileCount  = families.filter(f => f.direction === 'volatile').length;
  const stableCount    = families.filter(f => f.direction === 'stable').length;

  return {
    ok: true,
    families,
    totalFamilies: families.length,
    windowSize:    snapshots.length,
    improvingCount, degradingCount, volatileCount, stableCount,
    summary: `V339 trend analysis: ${families.length} families over ${snapshots.length} snapshots — ` +
             `${improvingCount} improving, ${degradingCount} degrading, ${volatileCount} volatile, ${stableCount} stable`,
    version: HEALTH_TREND_VERSION_339,
  };
}

/* ─── 2. detectRegressionAlerts339 ───────────────────────────────────────── */

/**
 * Scan a trend analysis result for families warranting action.
 * Returns a list of alert objects sorted by severity (critical first).
 *
 * Alert severity rules:
 *   - critical: family is 'degrading' AND latestTier is 'critical'
 *   - critical: family has tierRegressions >= 2
 *   - warning:  family is 'degrading' AND latestTier is 'watch'
 *   - warning:  family is 'volatile' AND latestTier is 'critical'
 *   - info:     family is 'degrading' AND latestTier is 'healthy' (still falling)
 *   - info:     family has tierRegressions >= 1
 *
 * @param {object}  trendResult   Return value of analyzeHealthTrend339
 * @param {object}  [opts]
 * @param {number}  [opts.minDataPoints=2]  Families with fewer data points are skipped
 * @returns {{ ok, alerts[], criticalCount, warningCount, infoCount, summary, version }}
 */
function detectRegressionAlerts339(trendResult, opts) {
  opts = opts || {};
  const minDataPoints = typeof opts.minDataPoints === 'number' ? opts.minDataPoints : 2;

  if (!trendResult || !Array.isArray(trendResult.families)) {
    return {
      ok: false, error: 'trendResult must be the output of analyzeHealthTrend339',
      alerts: [], criticalCount: 0, warningCount: 0, infoCount: 0,
      summary: 'V339 regression alerts: invalid trend result',
      version: HEALTH_TREND_VERSION_339,
    };
  }

  const alerts = [];
  const SEVERITY_RANK = { critical: 3, warning: 2, info: 1 };

  for (const f of trendResult.families) {
    if (f.dataPoints < minDataPoints) continue;

    const sev = new Set();

    if (f.direction === 'degrading' && f.latestTier === 'critical') sev.add('critical');
    if (f.tierRegressions >= 2) sev.add('critical');
    if (f.direction === 'degrading' && f.latestTier === 'watch')    sev.add('warning');
    if (f.direction === 'volatile'  && f.latestTier === 'critical') sev.add('warning');
    if (f.direction === 'degrading' && f.latestTier === 'healthy')  sev.add('info');
    if (f.tierRegressions >= 1 && !sev.has('critical') && !sev.has('warning')) sev.add('info');

    if (sev.size === 0) continue;

    // Pick highest severity
    const severity = sev.has('critical') ? 'critical' : sev.has('warning') ? 'warning' : 'info';

    alerts.push({
      base:            f.base,
      severity,
      direction:       f.direction,
      slope:           f.slope,
      latestTier:      f.latestTier,
      firstTier:       f.firstTier,
      tierRegressions: f.tierRegressions,
      netChange:       f.netChange,
      latestScore:     f.latestScore,
      dataPoints:      f.dataPoints,
      message: `Family "${f.base}" is ${f.direction} ` +
               `(score ${f.firstScore}→${f.latestScore}, ${f.netChange >= 0 ? '+' : ''}${f.netChange}; ` +
               `tier: ${f.firstTier}→${f.latestTier}; regressions: ${f.tierRegressions})`,
    });
  }

  // Sort: critical first, then by slope (worst first)
  alerts.sort((a, b) =>
    (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0) ||
    (a.slope ?? 0) - (b.slope ?? 0)
  );

  const criticalCount = alerts.filter(a => a.severity === 'critical').length;
  const warningCount  = alerts.filter(a => a.severity === 'warning').length;
  const infoCount     = alerts.filter(a => a.severity === 'info').length;

  return {
    ok: true,
    alerts,
    criticalCount, warningCount, infoCount,
    totalAlerts: alerts.length,
    summary: `V339 regression alerts: ${alerts.length} total — ${criticalCount} critical, ${warningCount} warning, ${infoCount} info`,
    version: HEALTH_TREND_VERSION_339,
  };
}

/* ─── 3. buildTrendReport339 ─────────────────────────────────────────────── */

/**
 * Full trend pipeline: accepts a loadHealthHistory338-style history object,
 * computes trends + alerts, and returns a complete trend report.
 *
 * @param {object}  historyResult   Return value of loadHealthHistory338
 * @param {object}  [opts]
 * @param {number}  [opts.windowSize]       Max snapshots to analyse (default: all)
 * @param {number}  [opts.slopeThreshold]   Forwarded to analyzeHealthTrend339
 * @param {number}  [opts.volatileStdDev]   Forwarded to analyzeHealthTrend339
 * @param {number}  [opts.minDataPoints]    Forwarded to detectRegressionAlerts339
 * @returns {{ ok, windowSize, trend, alerts, summary, version }}
 */
function buildTrendReport339(historyResult, opts) {
  opts = opts || {};

  if (!historyResult || !Array.isArray(historyResult.snapshots)) {
    return {
      ok: false, error: 'historyResult must be the output of loadHealthHistory338',
      windowSize: 0, trend: null, alerts: null,
      summary: 'V339 trend report: invalid history result',
      version: HEALTH_TREND_VERSION_339,
    };
  }

  let snapshots = historyResult.snapshots;
  if (typeof opts.windowSize === 'number' && opts.windowSize > 0) {
    // Take the most-recent windowSize snapshots (already in asc order)
    snapshots = snapshots.slice(-opts.windowSize);
  }

  const trend = analyzeHealthTrend339(snapshots, {
    slopeThreshold: opts.slopeThreshold,
    volatileStdDev: opts.volatileStdDev,
  });

  const alertsResult = detectRegressionAlerts339(trend, {
    minDataPoints: opts.minDataPoints,
  });

  const overallTrend = trend.ok
    ? (trend.improvingCount > trend.degradingCount ? 'improving'
     : trend.degradingCount > trend.improvingCount ? 'degrading' : 'mixed')
    : 'unknown';

  return {
    ok:               trend.ok,
    windowSize:       snapshots.length,
    totalSnapshots:   historyResult.totalSnapshots || historyResult.snapshots.length,
    overallTrend,
    trend,
    alerts:           alertsResult,
    criticalAlerts:   alertsResult.criticalCount || 0,
    warningAlerts:    alertsResult.warningCount  || 0,
    infoAlerts:       alertsResult.infoCount     || 0,
    generatedAt:      new Date().toISOString(),
    summary: `V339 trend report (window=${snapshots.length}): overall=${overallTrend}, ` +
             `${alertsResult.totalAlerts || 0} alerts (${alertsResult.criticalCount || 0} critical)`,
    version: HEALTH_TREND_VERSION_339,
  };
}

/* ─── 4. exportTrendSummary339 ───────────────────────────────────────────── */

/**
 * Serialize a buildTrendReport339 result to a JSON file.
 * Follows the same conventions as persistHealthReport338:
 *   - dryRun (default false) — report without writing
 *   - Idempotent by content hash (skip if identical file already exists)
 *   - Returns { ok, trendId, trendPath, action, byteSize, contentHash, dryRun, version }
 *
 * @param {object}  trendReport   Return value of buildTrendReport339
 * @param {object}  [opts]
 * @param {string}  [opts.trendDir]    Directory to write (default: env / tmpdir)
 * @param {boolean} [opts.dryRun=false]
 * @param {object}  [opts.meta]        Extra metadata to embed
 * @returns {{ ok, trendId, trendPath, action, byteSize, contentHash, dryRun, version }}
 */
function exportTrendSummary339(trendReport, opts) {
  opts = opts || {};
  const dryRun   = opts.dryRun === true;
  const trendDir = opts.trendDir || DEFAULT_TREND_DIR_339;
  const meta     = opts.meta    || {};

  if (!trendReport || typeof trendReport !== 'object') {
    return { ok: false, error: 'trendReport must be a non-null object', dryRun, version: HEALTH_TREND_VERSION_339 };
  }

  const ts      = new Date();
  const trendId = _trendId339(ts);

  const payload = JSON.stringify({
    trendId,
    exportedAt: ts.toISOString(),
    meta,
    report: {
      ok:             trendReport.ok,
      windowSize:     trendReport.windowSize,
      totalSnapshots: trendReport.totalSnapshots,
      overallTrend:   trendReport.overallTrend,
      criticalAlerts: trendReport.criticalAlerts,
      warningAlerts:  trendReport.warningAlerts,
      infoAlerts:     trendReport.infoAlerts,
      generatedAt:    trendReport.generatedAt,
      summary:        trendReport.summary,
      version:        trendReport.version,
      trend: trendReport.trend ? {
        totalFamilies:   trendReport.trend.totalFamilies,
        improvingCount:  trendReport.trend.improvingCount,
        degradingCount:  trendReport.trend.degradingCount,
        volatileCount:   trendReport.trend.volatileCount,
        stableCount:     trendReport.trend.stableCount,
        families:        (trendReport.trend.families || []).map(f => ({
          base:            f.base,
          direction:       f.direction,
          slope:           f.slope,
          netChange:       f.netChange,
          latestScore:     f.latestScore,
          latestTier:      f.latestTier,
          tierRegressions: f.tierRegressions,
          dataPoints:      f.dataPoints,
        })),
      } : null,
      alerts: trendReport.alerts ? {
        totalAlerts:   trendReport.alerts.totalAlerts,
        criticalCount: trendReport.alerts.criticalCount,
        warningCount:  trendReport.alerts.warningCount,
        infoCount:     trendReport.alerts.infoCount,
        alerts:        (trendReport.alerts.alerts || []).map(a => ({
          base: a.base, severity: a.severity, direction: a.direction,
          latestTier: a.latestTier, netChange: a.netChange, message: a.message,
        })),
      } : null,
    },
  }, null, 2);

  const contentHash = _hashTrend339(payload);
  const trendPath   = path.join(trendDir, trendId + '_' + contentHash + '.json');

  if (!dryRun) {
    _ensureDir339(trendDir);
    const existingFiles = fs.existsSync(trendDir)
      ? fs.readdirSync(trendDir).filter(n => n.includes(contentHash))
      : [];
    if (existingFiles.length > 0) {
      return {
        ok: true, trendId, trendPath: path.join(trendDir, existingFiles[0]),
        action: 'skip', byteSize: Buffer.byteLength(payload),
        contentHash, dryRun: false, version: HEALTH_TREND_VERSION_339,
        summary: 'V339 skip — identical trend summary already exists',
      };
    }
    fs.writeFileSync(trendPath, payload, 'utf8');
  }

  return {
    ok: true, trendId, trendPath,
    action:      dryRun ? 'dry-run' : 'write',
    byteSize:    Buffer.byteLength(payload),
    contentHash, dryRun,
    version: HEALTH_TREND_VERSION_339,
    summary: dryRun
      ? 'V339 DRY-RUN — would export trend summary ' + trendId
      : 'V339 exported trend summary ' + trendId + ' (' + Buffer.byteLength(payload) + ' bytes)',
  };
}

/* ─── exports ─────────────────────────────────────────────────────────────── */

module.exports = {
  HEALTH_TREND_VERSION_339,
  analyzeHealthTrend339,
  detectRegressionAlerts339,
  buildTrendReport339,
  exportTrendSummary339,
};
