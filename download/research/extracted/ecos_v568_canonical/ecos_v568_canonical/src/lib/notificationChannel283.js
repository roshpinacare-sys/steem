'use strict';
/**
 * src/lib/notificationChannel283.js — ECOS Notification Channel-Template Binding (V283)
 *
 * V283 extends the V282 notification template engine with channel-template binding:
 *   - registerNotificationChannel283(name, opts)  — register a channel (optionally bound to a template)
 *   - deregisterNotificationChannel283(name)       — remove a channel
 *   - setChannelTemplate283(channelName, templateName) — bind/change template post-registration
 *   - unsetChannelTemplate283(channelName)         — unbind template from channel
 *   - getChannel283(name)                          — get a single channel
 *   - getChannels283()                             — list all channels
 *   - notifyDigest283(digest, opts)                — deliver digest, rendering per-channel template if bound
 *   - testChannel283(channelName, sampleDigest)    — dry-run delivery with template rendering
 *   - getStatus283()                               — runtime status
 *   - checkNotificationChannelHealth283()          — health check
 *   - getPerf283()                                 — latency percentiles (1000-sample ring)
 *
 * Iron rules: zero new npm deps. All identifiers end in 283. Sacred files untouched.
 */

const crypto = require('node:crypto');

const CHANNEL_VERSION_283       = '283';
const CHANNEL_MAX_CHANNELS_283  = 200;

class NotificationChannel283 {
  /**
   * @param {object} opts
   * @param {object} [opts.logger]
   * @param {object} [opts.logAdapter]
   * @param {object} [opts.notificationTemplate282]  — optional V282 template engine for rendering
   */
  constructor(opts = {}) {
    this._logger283              = opts.logger                 || console;
    this._logAdapter283          = opts.logAdapter             || null;
    this._templateEngine283      = opts.notificationTemplate282 || null;

    // Channel registry: Map<name, channelConfig>
    this._channels283 = new Map();

    // Delivery log ring (last 500 deliveries)
    this._deliveryLog283 = [];

    // Perf ring buffer (last 1000 latencies)
    this._perfLatencies283 = [];
  }

  // ── Channel Registry ─────────────────────────────────────────────────────────

  /**
   * Register a notification channel.
   *
   * @param {string} name — unique channel name
   * @param {object} opts
   * @param {string} opts.url             — webhook URL (required)
   * @param {string} [opts.templateName]  — optional template to bind at registration
   * @param {string} [opts.method]        — HTTP method (default: 'POST')
   * @param {object} [opts.headers]       — extra HTTP headers
   * @param {string} [opts.description]   — human-readable description
   * @returns {{ ok, name, templateName, registeredAt, version }}
   */
  registerNotificationChannel283(name, opts = {}) {
    const _t0 = Date.now();
    if (!name || typeof name !== 'string')
      return { ok: false, error: 'name must be a non-empty string', version: CHANNEL_VERSION_283 };
    if (this._channels283.has(name))
      return { ok: false, error: `channel '${name}' already registered`, version: CHANNEL_VERSION_283 };
    if (this._channels283.size >= CHANNEL_MAX_CHANNELS_283)
      return { ok: false, error: `channel limit (${CHANNEL_MAX_CHANNELS_283}) reached`, version: CHANNEL_VERSION_283 };
    if (!opts.url || typeof opts.url !== 'string')
      return { ok: false, error: 'url must be a non-empty string', version: CHANNEL_VERSION_283 };

    const channel = {
      name,
      url:            opts.url,
      method:         opts.method || 'POST',
      headers:        opts.headers || {},
      templateName:   opts.templateName || null,
      description:    opts.description || '',
      registeredAt:   new Date().toISOString(),
    };
    this._channels283.set(name, channel);
    this._recordPerf283(Date.now() - _t0);
    return {
      ok:           true,
      name,
      templateName: channel.templateName,
      registeredAt: channel.registeredAt,
      version:      CHANNEL_VERSION_283,
    };
  }

  /**
   * Remove a registered channel.
   * @param {string} name
   * @returns {{ ok, name, version }}
   */
  deregisterNotificationChannel283(name) {
    const _t0 = Date.now();
    if (!this._channels283.has(name))
      return { ok: false, error: `channel '${name}' not found`, version: CHANNEL_VERSION_283 };
    this._channels283.delete(name);
    this._recordPerf283(Date.now() - _t0);
    return { ok: true, name, version: CHANNEL_VERSION_283 };
  }

  /**
   * Bind or change the template for an existing channel.
   * @param {string} channelName
   * @param {string} templateName
   * @returns {{ ok, channelName, templateName, version }}
   */
  setChannelTemplate283(channelName, templateName) {
    const _t0 = Date.now();
    if (!this._channels283.has(channelName))
      return { ok: false, error: `channel '${channelName}' not found`, version: CHANNEL_VERSION_283 };
    if (!templateName || typeof templateName !== 'string')
      return { ok: false, error: 'templateName must be a non-empty string', version: CHANNEL_VERSION_283 };
    const ch = this._channels283.get(channelName);
    ch.templateName = templateName;
    this._recordPerf283(Date.now() - _t0);
    return { ok: true, channelName, templateName, version: CHANNEL_VERSION_283 };
  }

  /**
   * Unbind the template from a channel.
   * @param {string} channelName
   * @returns {{ ok, channelName, version }}
   */
  unsetChannelTemplate283(channelName) {
    const _t0 = Date.now();
    if (!this._channels283.has(channelName))
      return { ok: false, error: `channel '${channelName}' not found`, version: CHANNEL_VERSION_283 };
    const ch = this._channels283.get(channelName);
    ch.templateName = null;
    this._recordPerf283(Date.now() - _t0);
    return { ok: true, channelName, version: CHANNEL_VERSION_283 };
  }

  // ── Retrieval ─────────────────────────────────────────────────────────────────

  /**
   * Get a single channel by name.
   * @param {string} name
   * @returns {{ ok, channel, version }}
   */
  getChannel283(name) {
    const ch = this._channels283.get(name);
    if (!ch)
      return { ok: false, error: `channel '${name}' not found`, version: CHANNEL_VERSION_283 };
    return { ok: true, channel: { ...ch }, version: CHANNEL_VERSION_283 };
  }

  /**
   * List all registered channels.
   * @returns {{ ok, channels, total, version }}
   */
  getChannels283() {
    const channels = Array.from(this._channels283.values()).map(c => ({ ...c }));
    return { ok: true, channels, total: channels.length, version: CHANNEL_VERSION_283 };
  }

  // ── Delivery ──────────────────────────────────────────────────────────────────

  /**
   * Deliver a digest to all registered channels, rendering per-channel template if bound.
   *
   * @param {object} digest   — digest payload
   * @param {object} [opts]
   * @param {string} [opts.channel]   — optional: deliver to a single named channel only
   * @returns {{ ok, delivered, skipped, errors, version }}
   */
  notifyDigest283(digest, opts = {}) {
    const _t0 = Date.now();
    const targetChannels = opts.channel
      ? (this._channels283.has(opts.channel) ? [this._channels283.get(opts.channel)] : [])
      : Array.from(this._channels283.values());

    const delivered = [];
    const skipped   = [];
    const errors    = [];

    for (const ch of targetChannels) {
      try {
        let payload = digest;
        if (ch.templateName && this._templateEngine283) {
          const rendered = this._templateEngine283.renderTemplate282(ch.templateName, digest);
          if (rendered.ok) {
            payload = rendered.contentType === 'json'
              ? { subject: rendered.subject, body: rendered.body }
              : rendered.body;
          } else {
            skipped.push({ channel: ch.name, reason: `template render failed: ${rendered.error}` });
            continue;
          }
        }
        // Record simulated delivery (real HTTP not available in sandbox)
        const entry = {
          deliveryId:  crypto.randomUUID(),
          channel:     ch.name,
          url:         ch.url,
          templateName: ch.templateName || null,
          ts:          new Date().toISOString(),
          status:      'delivered',
        };
        this._deliveryLog283.unshift(entry);
        if (this._deliveryLog283.length > 500) this._deliveryLog283.length = 500;
        delivered.push(ch.name);
      } catch (err) {
        errors.push({ channel: ch.name, error: err.message });
      }
    }

    this._recordPerf283(Date.now() - _t0);
    return { ok: true, delivered, skipped, errors, version: CHANNEL_VERSION_283 };
  }

  /**
   * Dry-run delivery: render template for a channel with a sample digest but do not send.
   * @param {string} channelName
   * @param {object} sampleDigest
   * @returns {{ ok, channelName, templateName, subject, body, contentType, version }}
   */
  testChannel283(channelName, sampleDigest = {}) {
    const _t0 = Date.now();
    const ch = this._channels283.get(channelName);
    if (!ch)
      return { ok: false, error: `channel '${channelName}' not found`, version: CHANNEL_VERSION_283 };

    if (!ch.templateName) {
      this._recordPerf283(Date.now() - _t0);
      return {
        ok:           true,
        channelName,
        templateName: null,
        subject:      null,
        body:         null,
        contentType:  null,
        note:         'no template bound; digest would be sent as-is',
        version:      CHANNEL_VERSION_283,
      };
    }

    if (!this._templateEngine283) {
      return { ok: false, error: 'template engine not available', version: CHANNEL_VERSION_283 };
    }

    const rendered = this._templateEngine283.previewTemplate282(ch.templateName, sampleDigest);
    this._recordPerf283(Date.now() - _t0);
    if (!rendered.ok)
      return { ok: false, error: rendered.error, version: CHANNEL_VERSION_283 };

    return {
      ok:           true,
      channelName,
      templateName: ch.templateName,
      subject:      rendered.subject,
      body:         rendered.body,
      contentType:  rendered.contentType,
      sampleContext: rendered.sampleContext,
      version:      CHANNEL_VERSION_283,
    };
  }

  // ── Status / Health ───────────────────────────────────────────────────────────

  /**
   * Runtime status.
   * @returns {{ ok, version, channelCount, deliveryLogSize }}
   */
  getStatus283() {
    return {
      ok:              true,
      version:         CHANNEL_VERSION_283,
      channelCount:    this._channels283.size,
      deliveryLogSize: this._deliveryLog283.length,
    };
  }

  /**
   * Health check.
   * @returns {{ ok, version, channelCount }}
   */
  checkNotificationChannelHealth283() {
    return {
      ok:           true,
      version:      CHANNEL_VERSION_283,
      channelCount: this._channels283.size,
    };
  }

  // ── Perf ──────────────────────────────────────────────────────────────────────

  _recordPerf283(ms) {
    this._perfLatencies283.push(ms);
    if (this._perfLatencies283.length > 1000) this._perfLatencies283.shift();
  }

  /**
   * Latency percentiles from ring buffer.
   * @returns {{ p50, p95, p99, count }}
   */
  getPerf283() {
    const lat = [...this._perfLatencies283].sort((a, b) => a - b);
    const n   = lat.length;
    if (n === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
    const pct = (p) => lat[Math.floor(p * n)] ?? lat[n - 1];
    return { p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), count: n };
  }
}

module.exports = { NotificationChannel283 };
