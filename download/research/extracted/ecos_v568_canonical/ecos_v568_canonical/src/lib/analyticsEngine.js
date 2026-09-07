'use strict';
  /**
   * ECOS Analytics Engine — V104
   * ==============================
   * Adopted from reference/v101-experimental-libs/analyticsEngine.js
   * Extended with: time-series export for mission dashboard, trend analysis,
   * and byDay breakdown for GET /api/v1/missions/dashboard.
   *
   * Granularity options:
   *   hour  — hourly buckets (ISO 8601 to the hour)
   *   day   — daily buckets  (ISO 8601 to the day)
   *
   * Each bucket stores:
   *   { ts, tasks, autoFlow, hitl, revenue, validatorPayout, rejections, blocked }
   *
   * Retention:
   *   hour buckets — last 168 hours (7 days)
   *   day  buckets — last 90 days
   */

  const RETENTION = {
    hour: 168,
    day:   90,
  };

  class AnalyticsEngine {
    constructor() {
      this._buckets = { hour: new Map(), day: new Map() };
      this._log = { info: () => {}, warn: () => {}, error: () => {} };
    }

    setLogger(logger) {
      if (logger && typeof logger.info === 'function') this._log = logger;
    }

    // ── Bucket helpers ──────────────────────────────────────────────────────────

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
      return { ts, tasks: 0, autoFlow: 0, hitl: 0, revenue: 0, validatorPayout: 0, rejections: 0, blocked: 0 };
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
      const map    = this._buckets[granularity];
      const maxAge = RETENTION[granularity];
      const cutoff = granularity === 'hour'
        ? Date.now() - maxAge * 3_600_000
        : Date.now() - maxAge * 86_400_000;
      for (const [key] of map) {
        if (new Date(key).getTime() < cutoff) map.delete(key);
      }
    }

    // ── Record a task event ─────────────────────────────────────────────────────

    /**
     * Record a task resolution event into both hour + day buckets.
     * @param {object} opts
     * @param {string} opts.verdict        — AUTO_FLOW | HITL_QUEUE | HARD_REJECT | BLOCK
     * @param {number|string} opts.revenue — gross USD amount
     * @param {number|string} opts.validatorPayout — validator share USD
     * @param {Date|string}   [opts.ts]    — defaults to now
     */
    record({ verdict, revenue = 0, validatorPayout = 0, ts } = {}) {
      const now = ts ? new Date(ts) : new Date();
      for (const g of ['hour', 'day']) {
        const bucket = this._getOrCreate(g, now);
        bucket.tasks++;
        if (verdict === 'AUTO_FLOW')   bucket.autoFlow++;
        if (verdict === 'HITL_QUEUE')  bucket.hitl++;
        if (verdict === 'HARD_REJECT') bucket.rejections++;
        if (verdict === 'BLOCK')       bucket.blocked++;
        bucket.revenue       += parseFloat(revenue)        || 0;
        bucket.validatorPayout += parseFloat(validatorPayout) || 0;
        this._prune(g);
      }
    }

    // ── Query ───────────────────────────────────────────────────────────────────

    /**
     * Get sorted buckets for a granularity within a time range.
     * @param {object} opts
     * @param {'hour'|'day'} opts.granularity
     * @param {Date|string}  [opts.from]
     * @param {Date|string}  [opts.to]
     * @param {number}       [opts.limit]
     * @returns {Array<bucket>}
     */
    query({ granularity = 'day', from, to, limit } = {}) {
      this._prune(granularity);
      const fromTs = from ? new Date(from).getTime() : 0;
      const toTs   = to   ? new Date(to).getTime()   : Infinity;
      const sorted = Array.from(this._buckets[granularity].values())
        .filter(b => {
          const t = new Date(b.ts).getTime();
          return t >= fromTs && t <= toTs;
        })
        .sort((a, b) => new Date(a.ts) - new Date(b.ts));
      return limit ? sorted.slice(-limit) : sorted;
    }

    /**
     * Get the last N day-buckets as a byDay array for the mission dashboard.
     * @param {number} [days=30]
     * @returns {Array<{ date, total, approved, rejected, blocked, autoFlow, hitl }>}
     */
    getByDay(days = 30) {
      const buckets = this.query({ granularity: 'day', limit: days });
      return buckets.map(b => ({
        date:     b.ts.slice(0, 10),
        total:    b.tasks,
        approved: b.hitl + b.autoFlow,
        rejected: b.rejections,
        blocked:  b.blocked,
        autoFlow: b.autoFlow,
        hitl:     b.hitl,
        revenue:  parseFloat(b.revenue.toFixed(4)),
      }));
    }

    // ── Trend ───────────────────────────────────────────────────────────────────

    /**
     * Compare current period vs previous period for a metric.
     * @param {'hour'|'day'} granularity
     * @param {string} metric — 'tasks' | 'revenue' | 'autoFlow' | 'hitl'
     * @param {number} [periods=7]
     * @returns {{ current: number, previous: number, delta: number, trend: 'up'|'down'|'flat' }}
     */
    trend(granularity = 'day', metric = 'tasks', periods = 7) {
      const all = this.query({ granularity });
      const len = all.length;
      const cur = all.slice(-periods).reduce((s, b) => s + (b[metric] || 0), 0);
      const prev = all.slice(Math.max(0, len - 2 * periods), Math.max(0, len - periods))
        .reduce((s, b) => s + (b[metric] || 0), 0);
      const delta = cur - prev;
      return {
        current:  cur,
        previous: prev,
        delta,
        trend: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
      };
    }

    /**
     * Summary of all time totals.
     */
    totals() {
      const all = this.query({ granularity: 'day' });
      return all.reduce((acc, b) => {
        acc.tasks         += b.tasks;
        acc.autoFlow      += b.autoFlow;
        acc.hitl          += b.hitl;
        acc.rejections    += b.rejections;
        acc.blocked       += b.blocked;
        acc.revenue       += b.revenue;
        acc.validatorPayout += b.validatorPayout;
        return acc;
      }, { tasks: 0, autoFlow: 0, hitl: 0, rejections: 0, blocked: 0, revenue: 0, validatorPayout: 0 });
    }
  }

  const defaultAnalyticsEngine = new AnalyticsEngine();

  module.exports = { AnalyticsEngine, defaultAnalyticsEngine };
  