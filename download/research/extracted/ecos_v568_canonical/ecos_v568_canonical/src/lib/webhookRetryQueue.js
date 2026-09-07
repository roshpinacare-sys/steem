/**
 * lib/webhookRetryQueue.js — V160
 * =================================
 * Webhook Persistent Retry Queue
 * תור retry מתמיד לwebhooks שנכשלו — scheduling + backoff + max retries
 *
 * תכונות:
 *  - שמירת failed deliveries ב-webhook_retry_queue (DB + in-memory)
 *  - Scheduling: retry_at = now + backoff (exp: 2^attempt × 30s, capped at 4h)
 *  - Background polling loop (integrate with metrics cron, every 60s)
 *  - Max retries: configurable (default 10)
 *  - Max age: configurable (default 72h) — deliveries older than max age are purged
 *  - Integration with WorkspaceWebhookService dispatch
 *  - Endpoints: retry-failed, queue stats, purge
 *
 * Sacred Files: lib/fiatLedger.js, lib/auditLog.js — UNTOUCHED
 * [V160-TASK-01]
 */

'use strict';

const crypto = require('crypto');
const https  = require('https');
const http   = require('http');
const { URL } = require('url');

const DEFAULT_MAX_RETRIES  = 10;
const DEFAULT_MAX_AGE_HOURS = 72;
const DEFAULT_BACKOFF_BASE  = 30000; // 30 seconds
const DEFAULT_BACKOFF_CAP   = 4 * 3600000; // 4 hours

// ── RetryRecord ────────────────────────────────────────────────────────────
class RetryRecord {
  constructor(data) {
    this.id          = data.id          || `rq_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    this.webhookId   = data.webhookId;
    this.workspaceId = data.workspaceId;
    this.eventType   = data.eventType;
    this.payload     = data.payload     || {};
    this.url         = data.url;
    this.secret      = data.secret      || '';
    this.attemptNum  = data.attemptNum  || 1;
    this.maxRetries  = data.maxRetries  || DEFAULT_MAX_RETRIES;
    this.status      = data.status      || 'pending'; // pending | processing | success | failed | abandoned
    this.lastError   = data.lastError   || null;
    this.retryAt     = data.retryAt     || new Date().toISOString();
    this.createdAt   = data.createdAt   || new Date().toISOString();
    this.processedAt = data.processedAt || null;
  }

  get isAbandoned() {
    return this.attemptNum > this.maxRetries;
  }

  get isExpired() {
    return false; // caller sets this via maxAge check
  }

  toJSON() {
    return {
      id:          this.id,
      webhookId:   this.webhookId,
      workspaceId: this.workspaceId,
      eventType:   this.eventType,
      attemptNum:  this.attemptNum,
      maxRetries:  this.maxRetries,
      status:      this.status,
      lastError:   this.lastError,
      retryAt:     this.retryAt,
      createdAt:   this.createdAt,
      processedAt: this.processedAt,
    };
  }
}

// ── WebhookRetryQueue ────────────────────────────────────────────────────────
class WebhookRetryQueue {
  /**
   * @param {object} opts
   * @param {object}   opts.logger          pino logger
   * @param {object}   opts.db              pg pool (optional)
   * @param {number}   opts.maxRetries      max attempts before abandoning (default 10)
   * @param {number}   opts.maxAgeHours     purge records older than N hours (default 72)
   * @param {number}   opts.backoffBase     base backoff ms (default 30000)
   * @param {number}   opts.backoffCap      max backoff ms (default 4h)
   * @param {number}   opts.pollIntervalMs  polling interval for background loop (default 60000)
   */
  constructor({
    logger         = null,
    db             = null,
    maxRetries     = DEFAULT_MAX_RETRIES,
    maxAgeHours    = DEFAULT_MAX_AGE_HOURS,
    backoffBase    = DEFAULT_BACKOFF_BASE,
    backoffCap     = DEFAULT_BACKOFF_CAP,
    pollIntervalMs = 60000,
  } = {}) {
    /** @type {Map<string, RetryRecord>} id → record */
    this._queue        = new Map();
    this._db           = db;
    this._log          = logger || { info: () => {}, warn: () => {}, error: () => {} };
    this.maxRetries    = maxRetries;
    this.maxAgeHours   = maxAgeHours;
    this.backoffBase   = backoffBase;
    this.backoffCap    = backoffCap;
    this.pollIntervalMs = pollIntervalMs;
    this._pollTimer    = null;
    this._processing   = false;
    this._stats        = { totalEnqueued: 0, totalSucceeded: 0, totalAbandoned: 0, totalPurged: 0 };
    this._version      = 'V160';
  }

  setDb(db) { this._db = db; }

  // ── enqueue a failed delivery for retry ──────────────────────────────────
  async enqueue(data) {
    if (!data.webhookId) throw new Error('webhookId required');
    if (!data.url)       throw new Error('url required');

    const record = new RetryRecord({
      ...data,
      maxRetries: data.maxRetries || this.maxRetries,
      status:     'pending',
    });

    this._queue.set(record.id, record);
    this._stats.totalEnqueued++;

    if (this._db) {
      try {
        await this._db.query(
          `INSERT INTO webhook_retry_queue
            (id, webhook_id, workspace_id, event_type, payload, url, secret,
             attempt_num, max_retries, status, retry_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (id) DO NOTHING`,
          [
            record.id, record.webhookId, record.workspaceId, record.eventType,
            JSON.stringify(record.payload), record.url, record.secret,
            record.attemptNum, record.maxRetries, record.status,
            record.retryAt, record.createdAt,
          ]
        );
      } catch (err) {
        this._log.warn({ err: err.message }, '[retryQueue] DB enqueue failed (in-memory persisted)');
      }
    }

    this._log.info({ id: record.id, webhookId: record.webhookId, attempt: record.attemptNum }, '[retryQueue] record enqueued');
    return record.toJSON();
  }

  // ── calculate next retry time using exponential backoff ──────────────────
  _nextRetryAt(attemptNum) {
    const delayMs = Math.min(this.backoffBase * Math.pow(2, attemptNum - 1), this.backoffCap);
    return new Date(Date.now() + delayMs).toISOString();
  }

  // ── attempt HTTP delivery ─────────────────────────────────────────────────
  _deliver(record) {
    return new Promise((resolve) => {
      const timeout    = setTimeout(() => resolve({ ok: false, status: 0, error: 'timeout' }), 10000);
      const body       = JSON.stringify({ event: record.eventType, payload: record.payload, retryAttempt: record.attemptNum });
      const sig        = record.secret
        ? 'sha256=' + crypto.createHmac('sha256', record.secret).update(body).digest('hex')
        : '';
      const urlParsed  = new URL(record.url);
      const transport  = urlParsed.protocol === 'https:' ? https : http;
      const opts = {
        hostname: urlParsed.hostname,
        port:     urlParsed.port || (urlParsed.protocol === 'https:' ? 443 : 80),
        path:     urlParsed.pathname + urlParsed.search,
        method:   'POST',
        headers:  {
          'Content-Type':    'application/json',
          'Content-Length':  Buffer.byteLength(body),
          'X-ECOS-Signature': sig,
          'X-ECOS-Retry':     String(record.attemptNum),
          'X-ECOS-Event':     record.eventType || '',
        },
      };

      const req = transport.request(opts, (res) => {
        clearTimeout(timeout);
        res.resume();
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode });
      });

      req.on('error', (err) => {
        clearTimeout(timeout);
        resolve({ ok: false, status: 0, error: err.message });
      });

      req.write(body);
      req.end();
    });
  }

  // ── process due records ──────────────────────────────────────────────────
  async processDue() {
    if (this._processing) return { processed: 0, succeeded: 0, requeued: 0, abandoned: 0 };
    this._processing = true;
    const now = Date.now();
    let processed = 0, succeeded = 0, requeued = 0, abandoned = 0;

    // load from DB if available
    if (this._db) {
      try {
        const r = await this._db.query(
          `SELECT * FROM webhook_retry_queue
           WHERE status='pending' AND retry_at <= $1
           ORDER BY retry_at ASC LIMIT 50`,
          [new Date().toISOString()]
        );
        for (const row of r.rows) {
          if (!this._queue.has(row.id)) {
            this._queue.set(row.id, new RetryRecord({
              ...row,
              webhookId:   row.webhook_id,
              workspaceId: row.workspace_id,
              eventType:   row.event_type,
              maxRetries:  row.max_retries,
              attemptNum:  row.attempt_num,
              lastError:   row.last_error,
              retryAt:     row.retry_at,
              createdAt:   row.created_at,
              processedAt: row.processed_at,
              payload:     typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload || {}),
            }));
          }
        }
      } catch (err) {
        this._log.warn({ err: err.message }, '[retryQueue] DB load failed, using in-memory');
      }
    }

    const due = [...this._queue.values()].filter(
      r => r.status === 'pending' && new Date(r.retryAt).getTime() <= now
    );

    for (const record of due) {
      record.status = 'processing';
      processed++;

      try {
        const result = await this._deliver(record);
        record.processedAt = new Date().toISOString();

        if (result.ok) {
          record.status = 'success';
          this._stats.totalSucceeded++;
          succeeded++;
          if (this._db) {
            this._db.query(
              `UPDATE webhook_retry_queue SET status='success', processed_at=$2 WHERE id=$1`,
              [record.id, record.processedAt]
            ).catch(() => {});
          }
          this._log.info({ id: record.id, status: result.status }, '[retryQueue] delivery succeeded');
        } else {
          record.attemptNum++;
          record.lastError  = result.error || `HTTP ${result.status}`;
          if (record.attemptNum > record.maxRetries) {
            record.status = 'abandoned';
            this._stats.totalAbandoned++;
            abandoned++;
            this._log.warn({ id: record.id, attempts: record.attemptNum }, '[retryQueue] delivery abandoned (max retries)');
          } else {
            record.status  = 'pending';
            record.retryAt = this._nextRetryAt(record.attemptNum);
            requeued++;
            this._log.info({ id: record.id, nextRetry: record.retryAt }, '[retryQueue] requeued for retry');
          }
          if (this._db) {
            this._db.query(
              `UPDATE webhook_retry_queue SET status=$2, attempt_num=$3, last_error=$4, retry_at=$5, processed_at=$6 WHERE id=$1`,
              [record.id, record.status, record.attemptNum, record.lastError, record.retryAt, record.processedAt]
            ).catch(() => {});
          }
        }
      } catch (err) {
        record.status    = 'pending';
        record.lastError = err.message;
        record.attemptNum++;
        record.retryAt   = this._nextRetryAt(record.attemptNum);
        requeued++;
      }
    }

    this._processing = false;
    return { processed, succeeded, requeued, abandoned };
  }

  // ── start background polling loop ────────────────────────────────────────
  startPolling() {
    if (this._pollTimer) return;
    this._pollTimer = setInterval(async () => {
      try { await this.processDue(); } catch (_) {}
    }, this.pollIntervalMs);
    this._pollTimer.unref && this._pollTimer.unref();
    this._log.info({ intervalMs: this.pollIntervalMs }, '[retryQueue] background polling started');
  }

  stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  // ── purge old records ─────────────────────────────────────────────────────
  purgeOld() {
    const cutoff = Date.now() - this.maxAgeHours * 3600000;
    let removed  = 0;
    for (const [id, r] of this._queue) {
      if (new Date(r.createdAt).getTime() < cutoff && r.status !== 'pending') {
        this._queue.delete(id);
        removed++;
      }
    }
    this._stats.totalPurged += removed;
    if (this._db) {
      const cutoffDate = new Date(cutoff).toISOString();
      this._db.query(
        `DELETE FROM webhook_retry_queue WHERE created_at < $1 AND status != 'pending'`,
        [cutoffDate]
      ).catch(() => {});
    }
    return removed;
  }

  // ── retry all failed for a specific webhook ───────────────────────────────
  requeueFailed(webhookId) {
    let count = 0;
    for (const r of this._queue.values()) {
      if (r.webhookId === webhookId && ['failed', 'abandoned'].includes(r.status)) {
        r.status     = 'pending';
        r.retryAt    = new Date().toISOString();
        r.attemptNum = 1;
        count++;
      }
    }
    return count;
  }

  // ── get queue for a webhook ───────────────────────────────────────────────
  getQueue(webhookId = null, status = null) {
    let records = [...this._queue.values()];
    if (webhookId) records = records.filter(r => r.webhookId === webhookId);
    if (status)    records = records.filter(r => r.status    === status);
    return records.sort((a, b) => new Date(a.retryAt) - new Date(b.retryAt)).map(r => r.toJSON());
  }

  // ── stats ─────────────────────────────────────────────────────────────────
  stats() {
    const all      = [...this._queue.values()];
    const byStatus = {};
    for (const r of all) { byStatus[r.status] = (byStatus[r.status] || 0) + 1; }
    return {
      queueSize:      all.length,
      byStatus,
      ...this._stats,
      maxRetries:     this.maxRetries,
      maxAgeHours:    this.maxAgeHours,
      pollActive:     !!this._pollTimer,
      version:        this._version,
    };
  }
}

const defaultRetryQueue = new WebhookRetryQueue();

module.exports = {
  WebhookRetryQueue,
  RetryRecord,
  defaultRetryQueue,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_AGE_HOURS,
};
