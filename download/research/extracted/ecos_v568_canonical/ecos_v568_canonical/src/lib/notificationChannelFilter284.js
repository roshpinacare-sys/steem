'use strict';
/**
 * src/lib/notificationChannelFilter284.js — ECOS Channel Filters (V284)
 *
 * V284 extends the V283 notification channel registry with per-channel filters:
 *   - setChannelFilter284(channelName, filterOpts)  — define which alerts to include/exclude
 *   - getChannelFilter284(channelName)              — retrieve current filter config
 *   - removeChannelFilter284(channelName)           — remove filter (channel receives all alerts)
 *   - applyChannelFilter284(channelName, digest)    — test whether a digest passes a channel's filter
 *   - notifyDigest284(digest, opts)                 — deliver with filters applied before delivery
 *   - testChannelFilter284(channelName, sampleDigest) — dry-run with filter applied
 *   - getStatus284()                                — runtime status
 *   - checkChannelFilterHealth284()                 — health check
 *   - getPerf284()                                  — latency percentiles (1000-sample ring)
 *
 * Iron rules: zero new npm deps. All identifiers end in 284. Sacred files untouched.
 */

const FILTER_VERSION_284     = '284';
const FILTER_MAX_FILTERS_284 = 200;

/**
 * Supported filter fields:
 *   categories      {string[]}  — include only alerts whose category is in this list
 *   excludeCategories {string[]}— exclude alerts whose category is in this list
 *   minSeverity     {string}    — minimum severity level ('low'|'medium'|'high'|'critical')
 *   maxAlerts       {number}    — only deliver if totalAlerts <= maxAlerts
 *   minAlerts       {number}    — only deliver if totalAlerts >= minAlerts
 *   periods         {string[]}  — only deliver for these digest periods ('daily'|'weekly'|'scheduled'|…)
 *   custom          {object}    — arbitrary key/value that must all match the digest top-level fields
 */

const SEVERITY_ORDER_284 = ['low', 'medium', 'high', 'critical'];

class ChannelFilter284 {
  /**
   * @param {object} opts
   * @param {object} [opts.logger]
   * @param {object} [opts.logAdapter]
   * @param {object} [opts.notificationChannel283]  — optional V283 channel engine for delegation
   */
  constructor(opts = {}) {
    this._logger284              = opts.logger                 || console;
    this._logAdapter284          = opts.logAdapter             || null;
    this._channelEngine284       = opts.notificationChannel283 || null;

    // Filter registry: Map<channelName, filterConfig>
    this._filters284 = new Map();

    // Delivery log ring (last 500 entries)
    this._deliveryLog284 = [];

    // Perf ring buffer (last 1000 latencies)
    this._perfLatencies284 = [];
  }

  // ── Filter Registry ──────────────────────────────────────────────────────────

  /**
   * Set (create or replace) a filter for a channel.
   *
   * @param {string} channelName
   * @param {object} filterOpts
   * @param {string[]} [filterOpts.categories]         — allowlist of categories
   * @param {string[]} [filterOpts.excludeCategories]  — denylist of categories
   * @param {string}   [filterOpts.minSeverity]        — minimum severity
   * @param {number}   [filterOpts.maxAlerts]          — max totalAlerts to pass
   * @param {number}   [filterOpts.minAlerts]          — min totalAlerts to pass
   * @param {string[]} [filterOpts.periods]            — allowed digest periods
   * @param {object}   [filterOpts.custom]             — custom key/value match
   * @returns {{ ok, channelName, filter, version }}
   */
  setChannelFilter284(channelName, filterOpts = {}) {
    const _t0 = Date.now();
    if (!channelName || typeof channelName !== 'string')
      return { ok: false, error: 'channelName must be a non-empty string', version: FILTER_VERSION_284 };
    if (this._filters284.size >= FILTER_MAX_FILTERS_284 && !this._filters284.has(channelName))
      return { ok: false, error: `filter limit (${FILTER_MAX_FILTERS_284}) reached`, version: FILTER_VERSION_284 };

    const validationError = this._validateFilterOpts284(filterOpts);
    if (validationError)
      return { ok: false, error: validationError, version: FILTER_VERSION_284 };

    const filter = {
      channelName,
      categories:        Array.isArray(filterOpts.categories)        ? [...filterOpts.categories]        : null,
      excludeCategories: Array.isArray(filterOpts.excludeCategories) ? [...filterOpts.excludeCategories] : null,
      minSeverity:       typeof filterOpts.minSeverity === 'string'  ? filterOpts.minSeverity            : null,
      maxAlerts:         typeof filterOpts.maxAlerts   === 'number'  ? filterOpts.maxAlerts              : null,
      minAlerts:         typeof filterOpts.minAlerts   === 'number'  ? filterOpts.minAlerts              : null,
      periods:           Array.isArray(filterOpts.periods)           ? [...filterOpts.periods]           : null,
      custom:            filterOpts.custom && typeof filterOpts.custom === 'object'
                           ? { ...filterOpts.custom }
                           : null,
      setAt: new Date().toISOString(),
    };

    this._filters284.set(channelName, filter);
    this._recordPerf284(Date.now() - _t0);
    return { ok: true, channelName, filter: { ...filter }, version: FILTER_VERSION_284 };
  }

  /**
   * Get the filter for a channel.
   *
   * @param {string} channelName
   * @returns {{ ok, channelName, filter, version }}
   */
  getChannelFilter284(channelName) {
    const _t0 = Date.now();
    if (!channelName || typeof channelName !== 'string')
      return { ok: false, error: 'channelName must be a non-empty string', version: FILTER_VERSION_284 };
    const filter = this._filters284.get(channelName);
    this._recordPerf284(Date.now() - _t0);
    if (!filter)
      return { ok: false, error: `no filter found for channel '${channelName}'`, version: FILTER_VERSION_284 };
    return { ok: true, channelName, filter: { ...filter }, version: FILTER_VERSION_284 };
  }

  /**
   * Remove the filter from a channel (channel will receive all alerts).
   *
   * @param {string} channelName
   * @returns {{ ok, channelName, version }}
   */
  removeChannelFilter284(channelName) {
    const _t0 = Date.now();
    if (!channelName || typeof channelName !== 'string')
      return { ok: false, error: 'channelName must be a non-empty string', version: FILTER_VERSION_284 };
    if (!this._filters284.has(channelName)) {
      this._recordPerf284(Date.now() - _t0);
      return { ok: false, error: `no filter found for channel '${channelName}'`, version: FILTER_VERSION_284 };
    }
    this._filters284.delete(channelName);
    this._recordPerf284(Date.now() - _t0);
    return { ok: true, channelName, version: FILTER_VERSION_284 };
  }

  // ── Filter Application ───────────────────────────────────────────────────────

  /**
   * Apply a channel's filter to a digest.
   * Returns true if the digest passes (should be delivered), false if blocked.
   *
   * @param {string} channelName
   * @param {object} digest
   * @returns {{ ok, passes, channelName, reason, version }}
   */
  applyChannelFilter284(channelName, digest = {}) {
    const _t0 = Date.now();
    if (!channelName || typeof channelName !== 'string') {
      this._recordPerf284(Date.now() - _t0);
      return { ok: false, error: 'channelName must be a non-empty string', version: FILTER_VERSION_284 };
    }
    const filter = this._filters284.get(channelName);
    if (!filter) {
      // No filter = pass all
      this._recordPerf284(Date.now() - _t0);
      return { ok: true, passes: true, channelName, reason: 'no filter set', version: FILTER_VERSION_284 };
    }

    const check = this._runFilter284(filter, digest);
    this._recordPerf284(Date.now() - _t0);
    return { ok: true, passes: check.passes, channelName, reason: check.reason, version: FILTER_VERSION_284 };
  }

  /**
   * Deliver a digest to all registered channels, applying filters before delivery.
   * Delegates actual delivery to the V283 channel engine if available.
   *
   * @param {object} digest
   * @param {object} [opts]
   * @param {string} [opts.channel]  — deliver to a single named channel
   * @returns {{ ok, delivered, filtered, skipped, errors, version }}
   */
  notifyDigest284(digest = {}, opts = {}) {
    const _t0 = Date.now();
    const engine = this._channelEngine284;
    const delivered = [];
    const filtered  = [];
    const skipped   = [];
    const errors    = [];

    // Determine which channels to target
    let channelNames;
    if (opts.channel) {
      channelNames = [opts.channel];
    } else if (engine && typeof engine.getChannels283 === 'function') {
      const listResult = engine.getChannels283();
      channelNames = (listResult.channels || []).map(c => c.name);
    } else {
      // No engine — apply filters to known filter keys
      channelNames = [...this._filters284.keys()];
    }

    for (const name of channelNames) {
      try {
        const filterResult = this.applyChannelFilter284(name, digest);
        if (!filterResult.passes) {
          filtered.push(name);
          continue;
        }

        // Deliver via V283 engine if available
        if (engine && typeof engine.notifyDigest283 === 'function') {
          const deliverResult = engine.notifyDigest283(digest, { channel: name });
          if (deliverResult.ok && deliverResult.delivered && deliverResult.delivered.length > 0) {
            delivered.push(name);
          } else if (deliverResult.skipped && deliverResult.skipped.length > 0) {
            skipped.push(name);
          } else {
            errors.push({ channel: name, error: deliverResult.errors ? deliverResult.errors[0] : 'delivery failed' });
          }
        } else {
          // No engine — record as delivered (in-memory only)
          delivered.push(name);
        }
      } catch (err) {
        errors.push({ channel: name, error: err.message });
      }
    }

    this._recordDeliveryLog284({ digest, delivered, filtered, skipped, errors, ts: new Date().toISOString() });
    this._recordPerf284(Date.now() - _t0);
    return { ok: true, delivered, filtered, skipped, errors, version: FILTER_VERSION_284 };
  }

  /**
   * Dry-run: apply filter + (optionally) render template for a channel — does not send.
   *
   * @param {string} channelName
   * @param {object} sampleDigest
   * @returns {{ ok, channelName, filter, passes, reason, subject?, body?, contentType?, note?, version }}
   */
  testChannelFilter284(channelName, sampleDigest = {}) {
    const _t0 = Date.now();
    if (!channelName || typeof channelName !== 'string') {
      this._recordPerf284(Date.now() - _t0);
      return { ok: false, error: 'channelName must be a non-empty string', version: FILTER_VERSION_284 };
    }

    const filterResult = this.applyChannelFilter284(channelName, sampleDigest);
    const filter = this._filters284.get(channelName) || null;

    const result = {
      ok:          true,
      channelName,
      filter:      filter ? { ...filter } : null,
      passes:      filterResult.passes,
      reason:      filterResult.reason,
      version:     FILTER_VERSION_284,
    };

    // Optionally dry-run template rendering via V283 engine
    if (filterResult.passes) {
      const engine = this._channelEngine284;
      if (engine && typeof engine.testChannel283 === 'function') {
        const testResult = engine.testChannel283(channelName, sampleDigest);
        if (testResult.ok) {
          result.subject     = testResult.subject;
          result.body        = testResult.body;
          result.contentType = testResult.contentType;
          result.templateName = testResult.templateName;
          result.note        = testResult.note;
        }
      } else {
        result.note = 'filter passed; no template engine available for rendering';
      }
    } else {
      result.note = `delivery blocked by filter: ${filterResult.reason}`;
    }

    this._recordPerf284(Date.now() - _t0);
    return result;
  }

  // ── Status / Health / Perf ───────────────────────────────────────────────────

  /**
   * @returns {{ ok, version, filterCount, deliveryLogSize }}
   */
  getStatus284() {
    return {
      ok:              true,
      version:         FILTER_VERSION_284,
      filterCount:     this._filters284.size,
      deliveryLogSize: this._deliveryLog284.length,
    };
  }

  /**
   * @returns {{ ok, version, filterCount }}
   */
  checkChannelFilterHealth284() {
    return {
      ok:          true,
      version:     FILTER_VERSION_284,
      filterCount: this._filters284.size,
    };
  }

  /**
   * Returns latency percentiles from the 1000-sample ring buffer.
   * @returns {{ p50, p95, p99, count }}
   */
  getPerf284() {
    const arr = [...this._perfLatencies284].sort((a, b) => a - b);
    const count = arr.length;
    if (count === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
    const pct = (p) => arr[Math.min(Math.floor(p * count), count - 1)];
    return { p50: pct(0.50), p95: pct(0.95), p99: pct(0.99), count };
  }

  // ── Private Helpers ──────────────────────────────────────────────────────────

  _validateFilterOpts284(opts) {
    if (opts.minSeverity !== undefined && opts.minSeverity !== null) {
      if (!SEVERITY_ORDER_284.includes(opts.minSeverity))
        return `minSeverity must be one of: ${SEVERITY_ORDER_284.join(', ')}`;
    }
    if (opts.maxAlerts !== undefined && opts.maxAlerts !== null) {
      if (typeof opts.maxAlerts !== 'number' || opts.maxAlerts < 0)
        return 'maxAlerts must be a non-negative number';
    }
    if (opts.minAlerts !== undefined && opts.minAlerts !== null) {
      if (typeof opts.minAlerts !== 'number' || opts.minAlerts < 0)
        return 'minAlerts must be a non-negative number';
    }
    if (opts.maxAlerts !== undefined && opts.minAlerts !== undefined &&
        opts.maxAlerts !== null && opts.minAlerts !== null &&
        opts.maxAlerts < opts.minAlerts)
      return 'maxAlerts must be >= minAlerts';
    if (opts.categories !== undefined && !Array.isArray(opts.categories))
      return 'categories must be an array';
    if (opts.excludeCategories !== undefined && !Array.isArray(opts.excludeCategories))
      return 'excludeCategories must be an array';
    if (opts.periods !== undefined && !Array.isArray(opts.periods))
      return 'periods must be an array';
    return null;
  }

  _runFilter284(filter, digest) {
    // categories allowlist
    if (filter.categories && filter.categories.length > 0) {
      const cat = digest.category || digest.alertCategory || null;
      if (!cat || !filter.categories.includes(cat))
        return { passes: false, reason: `category '${cat}' not in allowlist` };
    }
    // excludeCategories denylist
    if (filter.excludeCategories && filter.excludeCategories.length > 0) {
      const cat = digest.category || digest.alertCategory || null;
      if (cat && filter.excludeCategories.includes(cat))
        return { passes: false, reason: `category '${cat}' is excluded` };
    }
    // minSeverity
    if (filter.minSeverity) {
      const digestSev = digest.severity || digest.alertSeverity || null;
      if (!digestSev)
        return { passes: false, reason: `digest has no severity; minSeverity is '${filter.minSeverity}'` };
      const minIdx     = SEVERITY_ORDER_284.indexOf(filter.minSeverity);
      const digestIdx  = SEVERITY_ORDER_284.indexOf(digestSev);
      if (digestIdx < 0)
        return { passes: false, reason: `unknown severity '${digestSev}'` };
      if (digestIdx < minIdx)
        return { passes: false, reason: `severity '${digestSev}' below minSeverity '${filter.minSeverity}'` };
    }
    // maxAlerts
    if (filter.maxAlerts !== null && filter.maxAlerts !== undefined) {
      const total = typeof digest.totalAlerts === 'number' ? digest.totalAlerts : 0;
      if (total > filter.maxAlerts)
        return { passes: false, reason: `totalAlerts (${total}) exceeds maxAlerts (${filter.maxAlerts})` };
    }
    // minAlerts
    if (filter.minAlerts !== null && filter.minAlerts !== undefined) {
      const total = typeof digest.totalAlerts === 'number' ? digest.totalAlerts : 0;
      if (total < filter.minAlerts)
        return { passes: false, reason: `totalAlerts (${total}) below minAlerts (${filter.minAlerts})` };
    }
    // periods
    if (filter.periods && filter.periods.length > 0) {
      const period = digest.period || null;
      if (!period || !filter.periods.includes(period))
        return { passes: false, reason: `period '${period}' not in allowed periods` };
    }
    // custom key/value match
    if (filter.custom && typeof filter.custom === 'object') {
      for (const [key, val] of Object.entries(filter.custom)) {
        if (digest[key] !== val)
          return { passes: false, reason: `custom field '${key}' does not match` };
      }
    }
    return { passes: true, reason: 'all conditions passed' };
  }

  _recordDeliveryLog284(entry) {
    this._deliveryLog284.push(entry);
    if (this._deliveryLog284.length > 500)
      this._deliveryLog284.shift();
  }

  _recordPerf284(ms) {
    this._perfLatencies284.push(ms);
    if (this._perfLatencies284.length > 1000)
      this._perfLatencies284.shift();
  }
}

module.exports = { ChannelFilter284, SEVERITY_ORDER_284, FILTER_VERSION_284 };
