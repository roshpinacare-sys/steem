'use strict';
/**
 * identityTrendAnalyzer397.js — ECOS V397 D1
 *
 * Buckets enforcement, bypass, and denial events into configurable time
 * intervals (hour/day/week); computes event rates, rolling averages, and
 * delta vs the previous period; exposes trend direction (up/down/stable).
 *
 * Function: createIdentityTrendAnalyzer397({ auditLog, audit })
 * Method:   analyzeTrends397(opts?)
 */

const IDENTITY_TREND_ANALYZER_VERSION_397 = '397.0.0';

// Produced event type
const EVT_TREND_ANALYSIS_397 = 'identity_trend_analysis_event_type_397';

// Consumed event type prefixes
const ENFORCEMENT_TYPES_397 = [
  'identity_callsite_enforce_event_type_393',
  'identity_callsite_enforce_reward_event_type_393',
  'identity_batch_enforce_item_event_type_394',
];
const BYPASS_TYPES_397 = [
  'identity_callsite_bypass_event_type_393',
];
const DENIAL_TYPES_397 = [
  'identity_callsite_deny_event_type_393',
  'identity_rate_limit_event_type_396',
];

const VALID_INTERVALS_397 = ['hour', 'day', 'week'];
const INTERVAL_MS_397 = {
  hour: 60 * 60 * 1000,
  day:  24 * 60 * 60 * 1000,
  week: 7  * 24 * 60 * 60 * 1000,
};

const DELTA_THRESHOLD_397 = 0.05; // <5% change = stable

function createIdentityTrendAnalyzer397(opts = {}) {
  const auditLog = opts.auditLog || opts.audit || null;

  function _getEntries() {
    if (!auditLog) return [];
    if (typeof auditLog.getEntries === 'function') return auditLog.getEntries();
    if (Array.isArray(auditLog.entries)) return auditLog.entries;
    return [];
  }

  function _appendAudit(entry) {
    if (!auditLog) return;
    if (typeof auditLog.append === 'function') auditLog.append(entry);
  }

  function _categorize(type) {
    if (ENFORCEMENT_TYPES_397.includes(type)) return 'enforcement';
    if (BYPASS_TYPES_397.includes(type))      return 'bypass';
    if (DENIAL_TYPES_397.includes(type))      return 'denial';
    return null;
  }

  function _bucketKey(ts, intervalMs) {
    return Math.floor(ts / intervalMs) * intervalMs;
  }

  function _trendDirection(current, previous) {
    if (previous === 0) return current > 0 ? 'up' : 'stable';
    const delta = (current - previous) / previous;
    if (delta >  DELTA_THRESHOLD_397) return 'up';
    if (delta < -DELTA_THRESHOLD_397) return 'down';
    return 'stable';
  }

  function _rollingAverage(bucketValues) {
    if (bucketValues.length === 0) return 0;
    const sum = bucketValues.reduce((a, b) => a + b, 0);
    return sum / bucketValues.length;
  }

  /**
   * analyzeTrends397(opts?)
   *
   * opts.interval   — 'hour' | 'day' | 'week'  (default: 'day')
   * opts.sinceTs    — only include entries with ts >= sinceTs
   * opts.buckets    — number of most-recent buckets to analyse (default: 7)
   * opts.snapshot   — if true, append EVT_TREND_ANALYSIS_397 to audit log
   *
   * Returns:
   * {
   *   version, interval, intervalMs, sinceTs, analyzedAt,
   *   buckets: [ { bucketStart, enforcement, bypass, denial } ],
   *   rates:   { enforcement, bypass, denial },      // events per intervalMs
   *   rolling: { enforcement, bypass, denial },      // avg per bucket
   *   delta:   { enforcement, bypass, denial },      // current vs previous bucket (ratio)
   *   trend:   { enforcement, bypass, denial },      // 'up'|'down'|'stable'
   *   summary: { totalBuckets, totalEnforcement, totalBypass, totalDenial }
   * }
   */
  function analyzeTrends397(opts = {}) {
    const interval  = VALID_INTERVALS_397.includes(opts.interval) ? opts.interval : 'day';
    const intervalMs = INTERVAL_MS_397[interval];
    const sinceTs   = typeof opts.sinceTs === 'number' ? opts.sinceTs : 0;
    const maxBuckets = typeof opts.buckets === 'number' && opts.buckets > 0 ? opts.buckets : 7;
    const doSnapshot = opts.snapshot === true;

    const allEntries = _getEntries();

    // Build bucket map: bucketStart → { enforcement, bypass, denial }
    const bucketMap = new Map();

    for (const e of allEntries) {
      const ts   = e.ts || e.timestamp || 0;
      if (ts < sinceTs) continue;
      const type = e.type || e.eventType || '';
      const cat  = _categorize(type);
      if (!cat) continue;

      const key = _bucketKey(ts, intervalMs);
      if (!bucketMap.has(key)) {
        bucketMap.set(key, { enforcement: 0, bypass: 0, denial: 0 });
      }
      bucketMap.get(key)[cat]++;
    }

    // Sort bucket keys descending, take last maxBuckets
    const sortedKeys = Array.from(bucketMap.keys()).sort((a, b) => a - b);
    const recentKeys = sortedKeys.slice(-maxBuckets);

    const buckets = recentKeys.map(k => ({
      bucketStart: k,
      enforcement: bucketMap.get(k).enforcement,
      bypass:      bucketMap.get(k).bypass,
      denial:      bucketMap.get(k).denial,
    }));

    const cats = ['enforcement', 'bypass', 'denial'];
    const totals = { enforcement: 0, bypass: 0, denial: 0 };
    for (const b of buckets) {
      for (const c of cats) totals[c] += b[c];
    }

    // Rate = total events / number of buckets
    const n = buckets.length || 1;
    const rates   = {};
    const rolling = {};
    for (const c of cats) {
      rates[c]   = totals[c] / n;
      rolling[c] = _rollingAverage(buckets.map(b => b[c]));
    }

    // Delta = compare last bucket vs second-to-last bucket
    const last = buckets[buckets.length - 1] || { enforcement: 0, bypass: 0, denial: 0 };
    const prev = buckets[buckets.length - 2] || { enforcement: 0, bypass: 0, denial: 0 };
    const delta = {};
    const trend = {};
    for (const c of cats) {
      delta[c] = prev[c] === 0 ? (last[c] > 0 ? 1 : 0) : (last[c] - prev[c]) / prev[c];
      trend[c] = _trendDirection(last[c], prev[c]);
    }

    const now = Date.now();
    const result = {
      version:     IDENTITY_TREND_ANALYZER_VERSION_397,
      interval,
      intervalMs,
      sinceTs,
      analyzedAt:  now,
      buckets,
      rates,
      rolling,
      delta,
      trend,
      summary: {
        totalBuckets:     buckets.length,
        totalEnforcement: totals.enforcement,
        totalBypass:      totals.bypass,
        totalDenial:      totals.denial,
      },
    };

    if (doSnapshot) {
      _appendAudit({
        type: EVT_TREND_ANALYSIS_397,
        ts:   now,
        data: {
          interval,
          totalBuckets:     buckets.length,
          totalEnforcement: totals.enforcement,
          totalBypass:      totals.bypass,
          totalDenial:      totals.denial,
          trend,
        },
      });
    }

    return result;
  }

  return {
    analyzeTrends397,
    IDENTITY_TREND_ANALYZER_VERSION_397,
  };
}

module.exports = {
  createIdentityTrendAnalyzer397,
  IDENTITY_TREND_ANALYZER_VERSION_397,
  EVT_TREND_ANALYSIS_397,
  VALID_INTERVALS_397,
  INTERVAL_MS_397,
};
