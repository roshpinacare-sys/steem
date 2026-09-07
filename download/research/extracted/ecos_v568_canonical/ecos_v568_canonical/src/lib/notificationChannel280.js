'use strict';
/**
 * src/lib/notificationChannel280.js — ECOS Alert Notification Delivery (V280)
 *
 * V280 adds alert notification delivery on top of the V279 digest pipeline:
 *   - registerNotificationChannel280(name, opts)  — register a webhook/channel
 *   - deregisterNotificationChannel280(name)       — remove a channel
 *   - notifyDigest280(digest, opts)                — deliver digest to all matching channels
 *   - getChannels280()                             — list all registered channels
 *   - getNotificationHistory280(opts)              — delivery history (capped)
 *   - getStatus280()                               — runtime status
 *   - checkNotificationChannelHealth280()          — health check
 *   - shutdown280()                                — clean up timers
 *
 * Iron rules: zero new npm deps. All identifiers end in 280. Sacred files untouched.
 */

const crypto = require('node:crypto');

const NOTIFICATION_VERSION_280         = '280';
const NOTIFICATION_HISTORY_MAX_280     = 200;
const NOTIFICATION_DEFAULT_MAX_RETRIES = 3;
const NOTIFICATION_RETRY_DELAY_MS_280  = 2_000;
const NOTIFICATION_SSE_MAX_CLIENTS_280 = 200;
const NOTIFICATION_SSE_HEARTBEAT_MS    = 30_000;

// Notification event types
const NOTIFY_EVENT_DELIVERED_280  = 'NOTIFICATION_DELIVERED';
const NOTIFY_EVENT_FAILED_280     = 'NOTIFICATION_FAILED';
const NOTIFY_EVENT_RETRY_280      = 'NOTIFICATION_RETRY';
const NOTIFY_EVENT_REGISTERED_280 = 'CHANNEL_REGISTERED';
const NOTIFY_EVENT_REMOVED_280    = 'CHANNEL_REMOVED';

class NotificationChannel280 {
  /**
   * @param {object} opts
   * @param {object} [opts.logger]
   * @param {object} [opts.logAdapter]
   * @param {Function} [opts.httpPost]  — injectable HTTP POST fn for testing; signature: (url, payload) => Promise<{ok, status}>
   */
  constructor(opts = {}) {
    this._logger280     = opts.logger     || console;
    this._logAdapter280 = opts.logAdapter || null;
    this._httpPost280   = opts.httpPost   || _defaultHttpPost280;

    // Channel registry: Map<name, channelConfig>
    this._channels280 = new Map();

    // Notification delivery history (capped at 200)
    this._history280 = [];

    // Retry timers: Map<retryId, timerHandle>
    this._retryTimers280 = new Map();

    // SSE clients for notification events: Map<clientId, res>
    this._sseClients280 = new Map();

    // Heartbeat timer
    this._heartbeatTimer280 = null;

    // Perf ring buffer
    this._perf280 = { latencies: [] };
  }

  // ── Channel Registry ─────────────────────────────────────────────────────────

  /**
   * Register a notification channel (webhook or in-memory).
   *
   * @param {string} name — unique channel name
   * @param {object} opts
   * @param {string} [opts.url]          — webhook URL to POST digest payload to
   * @param {string[]} [opts.alertTypes] — filter: only notify for these alert types (empty = all)
   * @param {string} [opts.minSeverity]  — filter: 'INFO'|'WARNING'|'CRITICAL' (default: 'INFO')
   * @param {boolean} [opts.onlyBreached] — filter: only notify when breached > 0 (default: false)
   * @param {number} [opts.maxRetries]   — max delivery retries (default: 3)
   * @returns {{ ok, name, url, alertTypes, minSeverity, onlyBreached, maxRetries }}
   */
  registerNotificationChannel280(name, opts = {}) {
    const _t0 = Date.now();
    if (!name || typeof name !== 'string')
      return { ok: false, error: 'Channel name must be a non-empty string', version: NOTIFICATION_VERSION_280 };

    const channel = {
      name,
      url:          opts.url          || null,
      alertTypes:   Array.isArray(opts.alertTypes) ? opts.alertTypes : [],
      minSeverity:  opts.minSeverity  || 'INFO',
      onlyBreached: opts.onlyBreached || false,
      maxRetries:   typeof opts.maxRetries === 'number' ? opts.maxRetries : NOTIFICATION_DEFAULT_MAX_RETRIES,
      registeredAt: new Date().toISOString(),
    };

    this._channels280.set(name, channel);
    this._broadcastSseEvent280(NOTIFY_EVENT_REGISTERED_280, { name, url: channel.url });
    this._recordLatency280(_t0);
    return { ok: true, ...channel, version: NOTIFICATION_VERSION_280 };
  }

  /**
   * Remove a registered channel.
   *
   * @param {string} name
   * @returns {{ ok, name }}
   */
  deregisterNotificationChannel280(name) {
    if (!this._channels280.has(name))
      return { ok: false, error: `Channel not found: ${name}`, version: NOTIFICATION_VERSION_280 };
    this._channels280.delete(name);
    this._broadcastSseEvent280(NOTIFY_EVENT_REMOVED_280, { name });
    return { ok: true, name, version: NOTIFICATION_VERSION_280 };
  }

  /**
   * List all registered channels.
   *
   * @returns {{ ok, channels, total }}
   */
  getChannels280() {
    const channels = Array.from(this._channels280.values());
    return { ok: true, channels, total: channels.length, version: NOTIFICATION_VERSION_280 };
  }

  // ── Delivery ─────────────────────────────────────────────────────────────────

  /**
   * Deliver a digest to all channels that match its filters.
   *
   * @param {object} digest — result of generateAlertDigest279()
   * @param {object} [opts]
   * @param {boolean} [opts.force] — bypass filters and deliver to all channels
   * @returns {{ ok, attempted, delivered, failed, deliveries }}
   */
  async notifyDigest280(digest, opts = {}) {
    const _t0 = Date.now();
    const { force = false } = opts;

    if (!digest || typeof digest !== 'object')
      return { ok: false, error: 'digest must be an object', version: NOTIFICATION_VERSION_280 };

    const channels = Array.from(this._channels280.values());
    const results = [];

    for (const channel of channels) {
      if (!force && !this._matchesFilter280(digest, channel)) continue;
      const result = await this._deliverToChannel280(digest, channel);
      results.push(result);
    }

    const delivered = results.filter(r => r.ok).length;
    const failed    = results.filter(r => !r.ok).length;

    this._recordLatency280(_t0);
    return {
      ok:         true,
      attempted:  results.length,
      delivered,
      failed,
      deliveries: results,
      version:    NOTIFICATION_VERSION_280,
      ts:         new Date().toISOString(),
    };
  }

  /**
   * Get notification delivery history.
   *
   * @param {object} [opts]
   * @param {string} [opts.since]    — ISO timestamp; only entries after this
   * @param {number} [opts.limit]    — max results (default: 20)
   * @param {string} [opts.channel]  — filter by channel name
   * @returns {{ ok, deliveries, total }}
   */
  getNotificationHistory280(opts = {}) {
    const { since, limit = 20, channel } = opts;
    let deliveries = [...this._history280];

    if (since) {
      const sinceMs = new Date(since).getTime();
      deliveries = deliveries.filter(d => new Date(d.ts).getTime() > sinceMs);
    }
    if (channel) {
      deliveries = deliveries.filter(d => d.channel === channel);
    }

    // Most recent first
    deliveries = deliveries.slice(-limit).reverse();
    return { ok: true, deliveries, total: deliveries.length, version: NOTIFICATION_VERSION_280 };
  }

  // ── Health / Status ──────────────────────────────────────────────────────────

  /**
   * @returns {{ ok, version, channelCount, deliveryCount, pendingRetries, sseClients }}
   */
  checkNotificationChannelHealth280() {
    return {
      ok:             true,
      version:        NOTIFICATION_VERSION_280,
      channelCount:   this._channels280.size,
      deliveryCount:  this._history280.length,
      pendingRetries: this._retryTimers280.size,
      sseClients:     this._sseClients280.size,
    };
  }

  /**
   * @returns {{ ok, version, channelCount, deliveryCount, pendingRetries, sseClients }}
   */
  getStatus280() {
    return {
      ok:             true,
      version:        NOTIFICATION_VERSION_280,
      channelCount:   this._channels280.size,
      deliveryCount:  this._history280.length,
      pendingRetries: this._retryTimers280.size,
      sseClients:     this._sseClients280.size,
    };
  }

  getPerf280() {
    const lats = this._perf280.latencies;
    if (!lats.length) return { p50: 0, p95: 0, p99: 0, count: 0 };
    const sorted = [...lats].sort((a, b) => a - b);
    const p = (pct) => sorted[Math.floor(pct * sorted.length / 100)] || 0;
    return { p50: p(50), p95: p(95), p99: p(99), count: lats.length };
  }

  // ── SSE ──────────────────────────────────────────────────────────────────────

  /**
   * Add an SSE client for notification events.
   * @param {object} res — Express response object
   * @returns {string|null} clientId, or null if limit exceeded
   */
  addNotificationSseClient280(res) {
    if (this._sseClients280.size >= NOTIFICATION_SSE_MAX_CLIENTS_280) {
      res.status(503).json({ ok: false, error: 'SSE client limit reached', version: NOTIFICATION_VERSION_280 });
      return null;
    }
    const clientId = crypto.randomUUID();
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    this._sseClients280.set(clientId, res);
    res.on('close', () => this.removeNotificationSseClient280(clientId));

    // Send current channel list as initial event
    const initial = JSON.stringify({
      event:    'channels',
      channels: Array.from(this._channels280.values()),
      ts:       new Date().toISOString(),
    });
    res.write(`data: ${initial}\n\n`);

    if (!this._heartbeatTimer280) {
      this._heartbeatTimer280 = setInterval(() => this._sendHeartbeat280(), NOTIFICATION_SSE_HEARTBEAT_MS);
      if (this._heartbeatTimer280.unref) this._heartbeatTimer280.unref();
    }

    return clientId;
  }

  removeNotificationSseClient280(clientId) {
    this._sseClients280.delete(clientId);
    if (this._sseClients280.size === 0 && this._heartbeatTimer280) {
      clearInterval(this._heartbeatTimer280);
      this._heartbeatTimer280 = null;
    }
    return { ok: true, clientId, version: NOTIFICATION_VERSION_280 };
  }

  // ── Shutdown ─────────────────────────────────────────────────────────────────

  shutdown280() {
    // Clear heartbeat
    if (this._heartbeatTimer280) {
      clearInterval(this._heartbeatTimer280);
      this._heartbeatTimer280 = null;
    }
    // Clear retry timers
    for (const timer of this._retryTimers280.values()) clearTimeout(timer);
    this._retryTimers280.clear();
    // Close SSE clients
    for (const res of this._sseClients280.values()) {
      try { res.end(); } catch (_) {}
    }
    this._sseClients280.clear();
    return { ok: true, shutdown: true, version: NOTIFICATION_VERSION_280 };
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Attempt delivery of a digest to a single channel, with retry logic.
   */
  async _deliverToChannel280(digest, channel, attempt = 1) {
    const deliveryId = crypto.randomUUID();
    const ts         = new Date().toISOString();

    if (!channel.url) {
      // In-memory channel: just record success
      const record = { ok: true, deliveryId, channel: channel.name, attempt, ts, inMemory: true };
      this._appendHistory280(record);
      this._broadcastSseEvent280(NOTIFY_EVENT_DELIVERED_280, record);
      return record;
    }

    try {
      const result = await this._httpPost280(channel.url, digest);
      if (result.ok) {
        const record = { ok: true, deliveryId, channel: channel.name, attempt, status: result.status, ts };
        this._appendHistory280(record);
        this._broadcastSseEvent280(NOTIFY_EVENT_DELIVERED_280, record);
        return record;
      }

      // Non-2xx: schedule retry if attempts remain
      return this._scheduleRetry280(digest, channel, deliveryId, attempt, `HTTP ${result.status}`);
    } catch (err) {
      return this._scheduleRetry280(digest, channel, deliveryId, attempt, err.message);
    }
  }

  _scheduleRetry280(digest, channel, deliveryId, attempt, reason) {
    const ts = new Date().toISOString();
    if (attempt >= channel.maxRetries) {
      const record = { ok: false, deliveryId, channel: channel.name, attempt, reason, exhausted: true, ts };
      this._appendHistory280(record);
      this._broadcastSseEvent280(NOTIFY_EVENT_FAILED_280, record);
      return record;
    }

    const retryId = `${deliveryId}:${attempt}`;
    const timer = setTimeout(async () => {
      this._retryTimers280.delete(retryId);
      await this._deliverToChannel280(digest, channel, attempt + 1);
    }, NOTIFICATION_RETRY_DELAY_MS_280 * attempt);
    if (timer.unref) timer.unref();
    this._retryTimers280.set(retryId, timer);

    const record = { ok: false, deliveryId, channel: channel.name, attempt, reason, retrying: true, ts };
    this._broadcastSseEvent280(NOTIFY_EVENT_RETRY_280, record);
    return record;
  }

  /**
   * Test whether a digest matches a channel's filters.
   */
  _matchesFilter280(digest, channel) {
    // alertType filter
    if (channel.alertTypes.length > 0) {
      const topType = digest.topTypes?.[0]?.type;
      if (!topType || !channel.alertTypes.includes(topType)) return false;
    }
    // onlyBreached filter
    if (channel.onlyBreached && !(digest.breached > 0)) return false;
    // minSeverity filter (INFO < WARNING < CRITICAL)
    if (channel.minSeverity && channel.minSeverity !== 'INFO') {
      const sevOrder = { INFO: 0, WARNING: 1, CRITICAL: 2 };
      const digestMaxSev = digest.topTypes?.reduce((max, t) => {
        const sev = t.severity || 'INFO';
        return (sevOrder[sev] || 0) > (sevOrder[max] || 0) ? sev : max;
      }, 'INFO') || 'INFO';
      if ((sevOrder[digestMaxSev] || 0) < (sevOrder[channel.minSeverity] || 0)) return false;
    }
    return true;
  }

  _appendHistory280(record) {
    this._history280.push(record);
    if (this._history280.length > NOTIFICATION_HISTORY_MAX_280)
      this._history280.shift();
  }

  _broadcastSseEvent280(eventType, payload) {
    const data = JSON.stringify({ event: eventType, ...payload, ts: new Date().toISOString() });
    for (const res of this._sseClients280.values()) {
      try { res.write(`data: ${data}\n\n`); } catch (_) {}
    }
  }

  _sendHeartbeat280() {
    const data = JSON.stringify({ event: 'heartbeat', ts: new Date().toISOString() });
    for (const res of this._sseClients280.values()) {
      try { res.write(`data: ${data}\n\n`); } catch (_) {}
    }
  }

  _recordLatency280(t0) {
    const ms = Date.now() - t0;
    this._perf280.latencies.push(ms);
    if (this._perf280.latencies.length > 1000) this._perf280.latencies.shift();
  }
}

/**
 * Default HTTP POST implementation (fetch-based, Node 18+).
 * Returns { ok, status }.
 */
async function _defaultHttpPost280(url, payload) {
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });
  return { ok: res.ok, status: res.status };
}

module.exports = {
  NotificationChannel280,
  NOTIFICATION_VERSION_280,
  NOTIFICATION_HISTORY_MAX_280,
  NOTIFY_EVENT_DELIVERED_280,
  NOTIFY_EVENT_FAILED_280,
  NOTIFY_EVENT_RETRY_280,
  NOTIFY_EVENT_REGISTERED_280,
  NOTIFY_EVENT_REMOVED_280,
};
