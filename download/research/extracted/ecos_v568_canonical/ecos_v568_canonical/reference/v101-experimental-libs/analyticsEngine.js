'use strict';

/**
 * ECOS Analytics Engine — V101
 * ==============================
 * In-memory time-series analytics for tasks, revenue, and routing.
 *
 * Granularity options:
 *   hour  — hourly buckets (ISO 8601 to the hour: "2026-05-28T14:00:00.000Z")
 *   day   — daily buckets  (ISO 8601 to the day:  "2026-05-28T00:00:00.000Z")
 *
 * Each bucket stores:
 *   { ts, tasks, autoFlow, hitl, revenue, validatorPayout, rejections }
 *
 * Retention:
 *   hour buckets — last 168 hours (7 days)
 *   day  buckets — last 90 days
 */

const RETENTION = {
  hour: 168,   // 7 days × 24 hours
  day:   90,
};

const MAX_TREND_PERIODS = 2;  // compare current period vs previous for trend

class AnalyticsEngine {
  constructor() {
    // granularity → Map<bucketKey, bucket>
    this._buckets = {
      hour: new Map(),
      day:  new Map(),
    };
    this._log = { info: () => {}, warn: () => {}, error: () => {} };
  }

  setLogger(logger) {
    this._log = logger;
  }

  // ── Bucket key helpers ──────────────────────────────────────────────────────

  _bucketKey(granularity, ts) {
    const d = new Date(ts);
    if (granularity === 'hour') {
      d.setUTCMinutes(0, 0, 0);
    } else {
      d.setUTCHours(0, 0, 0, 0);
    }
    return d.toISOString();
  }

  _emptyBucket(ts) {
    return { ts, tasks: 0, autoFlow: 0, hitl: 0, revenue: 0, validatorPayout: 0, rejections: 0 };
  }

  _getOrCreate(granularity, ts) {
    const key = this._bucketKey(granularity, ts);
    if (!this._buckets[granularity].has(key)) {
      this._buckets[granularity].set(key, this._emptyBucket(key));
    }
    return this._buckets[granularity].get(key);
  }

  // ── Retention pruning ───────────────────────────────────────────────────────

  _prune(granularity) {
    const map     = this._buckets[granularity];
    const maxAge  = RETENTION[granularity];
    const cutoff  = granularity === 'hour'
      ? Date.now() - maxAge * 3600_000
      : Date.now() - maxAge * 86_400_000;
    for (const [key] of map) {
      if (new Date(key).getTime() < cutoff) map.delete(key);
    }
  }

  // ── Record a task event ─────────────────────────────────────────────────────

  /**
   * Record a new task event into analytics buckets.
   *
   * @param {object} opts
   * @param {'AUTO_FLOW'|'HITL_QUEUE'|'HARD_REJECT'} opts.verdict
   * @param {number|string} [opts.priceUsd=0]
   * @param {Date|string}   [opts.ts]            Defaults to now
   */
  record({ verdict, priceUsd = 0, ts } = {}) {
    const eventTs  = ts ? new Date(ts).getTime() : Date.now();
    const price    = parseFloat(priceUsd) || 0;
    const isAuto   = verdict === 'AUTO_FLOW';
    const isHitl   = verdict === 'HITL_QUEUE';
    const isReject = verdict === 'HARD_REJECT';

    for (const gran of ['hour', 'day']) {
      const bucket = this._getOrCreate(gran, eventTs);
      bucket.tasks        += 1;
      if (isAuto)   bucket.autoFlow       += 1;
      if (isHitl)   bucket.hitl           += 1;
      if (isReject) bucket.rejections     += 1;
      if (!isReject) {
        bucket.revenue          += price;
        bucket.validatorPayout  += isHitl ? price * 0.40 : 0;
      }
      // Round to avoid floating-point drift
      bucket.revenue         = Math.round(bucket.revenue * 10000) / 10000;
      bucket.validatorPayout = Math.round(bucket.validatorPayout * 10000) / 10000;
    }

    // Prune periodically (every 100 records)
    if (Math.random() < 0.01) {
      this._prune('hour');
      this._prune('day');
    }
  }

  // ── Query time series ───────────────────────────────────────────────────────

  /**
   * Return sorted array of bucket objects between from and to.
   *
   * @param {'hour'|'day'} granularity
   * @param {Date|string}  [from]   ISO string, defaults to 24h ago
   * @param {Date|string}  [to]     ISO string, defaults to now
   * @returns {object[]}
   */
  getTimeSeries(granularity = 'hour', from, to) {
    const gran = granularity === 'day' ? 'day' : 'hour';
    const toTs   = to   ? new Date(to).getTime()   : Date.now();
    const fromTs = from ? new Date(from).getTime() : toTs - (gran === 'hour' ? 24 * 3600_000 : 30 * 86_400_000);

    const results = [];
    for (const [key, bucket] of this._buckets[gran]) {
      const ts = new Date(key).getTime();
      if (ts >= fromTs && ts <= toTs) {
        results.push({ ...bucket });
      }
    }
    return results.sort((a, b) => new Date(a.ts) - new Date(b.ts));
  }

  // ── Summary stats ───────────────────────────────────────────────────────────

  /**
   * Aggregate summary over all retained data, with trend vs prior period.
   *
   * @param {'hour'|'day'} [granularity='day']
   * @returns {object}
   */
  getSummary(granularity = 'day') {
    const gran   = granularity === 'hour' ? 'hour' : 'day';
    const periodMs = gran === 'hour' ? 24 * 3600_000 : 7 * 86_400_000;
    const now    = Date.now();
    const cur    = this.getTimeSeries(gran, new Date(now - periodMs), new Date(now));
    const prev   = this.getTimeSeries(gran, new Date(now - 2 * periodMs), new Date(now - periodMs));

    const aggregate = (buckets) => buckets.reduce((acc, b) => ({
      tasks:           acc.tasks           + b.tasks,
      autoFlow:        acc.autoFlow        + b.autoFlow,
      hitl:            acc.hitl            + b.hitl,
      rejections:      acc.rejections      + b.rejections,
      revenue:         acc.revenue         + b.revenue,
      validatorPayout: acc.validatorPayout + b.validatorPayout,
    }), { tasks: 0, autoFlow: 0, hitl: 0, rejections: 0, revenue: 0, validatorPayout: 0 });

    const curAgg  = aggregate(cur);
    const prevAgg = aggregate(prev);

    const trend = (curr, prev) => {
      if (prev === 0) return curr > 0 ? 100 : 0;
      return Math.round(((curr - prev) / prev) * 100);
    };

    const autoFlowRate = curAgg.tasks > 0
      ? Math.round((curAgg.autoFlow / curAgg.tasks) * 100)
      : 0;

    return {
      period:        gran === 'hour' ? 'last_24h' : 'last_7d',
      granularity:   gran,
      current:       { ...curAgg, revenue: Math.round(curAgg.revenue * 100) / 100, validatorPayout: Math.round(curAgg.validatorPayout * 100) / 100 },
      previous:      { ...prevAgg, revenue: Math.round(prevAgg.revenue * 100) / 100, validatorPayout: Math.round(prevAgg.validatorPayout * 100) / 100 },
      trends: {
        tasks:           trend(curAgg.tasks, prevAgg.tasks),
        revenue:         trend(curAgg.revenue, prevAgg.revenue),
        autoFlow:        trend(curAgg.autoFlow, prevAgg.autoFlow),
        validatorPayout: trend(curAgg.validatorPayout, prevAgg.validatorPayout),
      },
      autoFlowRate,
    };
  }

  /**
   * Return bucket counts for health check.
   */
  get stats() {
    return {
      hourBuckets: this._buckets.hour.size,
      dayBuckets:  this._buckets.day.size,
    };
  }
}

module.exports = { AnalyticsEngine };
