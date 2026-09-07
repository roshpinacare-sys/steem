'use strict';

/**
 * ECOS NotificationService — V101
 * Fire-and-forget webhook delivery with a single retry on failure.
 * Never throws — all errors are logged via pino.
 *
 * [V101-P1] Webhook delivery log: ring buffer of last 200 delivery attempts.
 *   Access via getDeliveryLog() or GET /api/v1/webhooks/log
 *   Each entry: { ts, accountId, eventType, url, status, attempt, durationMs, error? }
 */

const http  = require('node:http');
const https = require('node:https');

const DELIVERY_LOG_MAX = 200;

class NotificationService {
  constructor() {
    // Map<accountId, url>
    this._webhooks = new Map();
    // [V101-P1] Ring-buffer delivery log
    this._deliveryLog = [];
    this._log = {
      info:  (obj, msg) => console.info(msg || obj),  // eslint-disable-line no-console
      warn:  (obj, msg) => console.warn(msg || obj),  // eslint-disable-line no-console
      error: (obj, msg) => console.error(msg || obj), // eslint-disable-line no-console
    };
  }

  /** Inject a pino logger (call immediately after construction). */
  setLogger(log) {
    if (log && typeof log.info === 'function') {
      this._log = log;
    }
  }

  /** Register a webhook URL for an account. */
  registerWebhook(accountId, url) {
    this._webhooks.set(accountId, url);
  }

  /** Unregister a webhook. */
  removeWebhook(accountId) {
    this._webhooks.delete(accountId);
  }

  /** Get the internal webhook map (for tests). */
  getWebhooks() {
    return this._webhooks;
  }

  /**
   * [V101-P1] Return the last N delivery log entries (default: all, max 200).
   * @param {number} [limit]
   * @returns {object[]}
   */
  getDeliveryLog(limit) {
    const n = (limit && limit > 0) ? Math.min(limit, DELIVERY_LOG_MAX) : this._deliveryLog.length;
    return this._deliveryLog.slice(-n);
  }

  /** [V101-P1] Append an entry to the delivery log ring buffer. */
  _logDelivery(entry) {
    this._deliveryLog.push(entry);
    if (this._deliveryLog.length > DELIVERY_LOG_MAX) this._deliveryLog.shift();
  }

  /**
   * Fire-and-forget POST notification.
   * Retries once on failure. Never throws.
   * @param {string} accountId
   * @param {string} eventType
   * @param {object} payload
   */
  async notify(accountId, eventType, payload) {
    const url = this._webhooks.get(accountId);
    if (!url) return; // no webhook registered — silent

    const body = JSON.stringify({
      eventType,
      payload,
      ts: new Date().toISOString(),
      ecosVersion: 'V101',
    });

    const startMs = Date.now();

    try {
      await this._post(url, body);
      const durationMs = Date.now() - startMs;
      this._log.info(
        { component: 'notification', accountId, eventType, url },
        '[Notification] Webhook delivered'
      );
      this._logDelivery({
        ts: new Date().toISOString(), accountId, eventType, url,
        status: 'ok', attempt: 1, durationMs,
      });
    } catch (err1) {
      // First attempt failed — retry once
      this._log.warn(
        { component: 'notification', accountId, eventType, url, err: err1.message },
        '[Notification] Webhook delivery failed, retrying once…'
      );
      const startRetryMs = Date.now();
      try {
        await this._post(url, body);
        const durationMs = Date.now() - startRetryMs;
        this._log.info(
          { component: 'notification', accountId, eventType, url },
          '[Notification] Webhook delivered (retry)'
        );
        this._logDelivery({
          ts: new Date().toISOString(), accountId, eventType, url,
          status: 'ok', attempt: 2, durationMs,
        });
      } catch (err2) {
        const durationMs = Date.now() - startMs;
        this._log.error(
          { component: 'notification', accountId, eventType, url, err: err2.message },
          '[Notification] Webhook delivery failed after retry'
        );
        this._logDelivery({
          ts: new Date().toISOString(), accountId, eventType, url,
          status: 'error', attempt: 2, durationMs, error: err2.message,
        });
        // Intentionally swallowed — must not throw
      }
    }
  }

  /** Internal: POST JSON to a URL with a 5-second timeout. */
  _post(url, body) {
    return new Promise((resolve, reject) => {
      let parsed;
      try {
        parsed = new URL(url);
      } catch (e) {
        return reject(new Error(`Invalid webhook URL: ${url}`));
      }

      const isHttps = parsed.protocol === 'https:';
      const mod     = isHttps ? https : http;
      const options = {
        hostname: parsed.hostname,
        port:     parsed.port || (isHttps ? 443 : 80),
        path:     parsed.pathname + (parsed.search || ''),
        method:   'POST',
        headers:  {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 5000,
      };

      const req = mod.request(options, (res) => {
        // Drain response body so socket is released
        res.resume();
        res.on('end', () => resolve({ statusCode: res.statusCode }));
      });

      req.on('timeout', () => {
        req.destroy(new Error('Webhook request timed out after 5s'));
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}

const defaultNotificationService = new NotificationService();

module.exports = { NotificationService, defaultNotificationService };
