'use strict';
  /**
   * webhookRetryQueue426.js — ECOS V426 Feature 2
   * Webhook retry queue for failed escalation webhooks. Retries with exponential
   * backoff up to configurable max attempts. Persists retry state to JSONL.
   * R1: sacred files untouched. R2: all identifiers end in 426. R3: no new npm deps.
   */

  const fs = require('fs');
  const path = require('path');
  const { createHash } = require('crypto');
  const https = require('https');
  const http = require('http');
  const { URL } = require('url');

  const WEBHOOK_RETRY_VERSION426 = '426.0.0';
  const MAX_RETRY_QUEUE426 = 1000;
  const MAX_RETRY_LOG426 = 500;
  const DEFAULT_MAX_ATTEMPTS426 = 5;
  const DEFAULT_BASE_DELAY_MS426 = 1000;
  const DEFAULT_MAX_DELAY_MS426 = 60000;
  const RETRY_SWEEP_MS426 = 5000; // check every 5s

  const _retryQueue426 = {
    queue: [],        // pending retries
    log: [],          // completed/failed history
    sweepHandle: null,
    dataDir: null,
    file: null,
    stats: {
      enqueued: 0,
      succeeded: 0,
      failed: 0,
      abandoned: 0,
      sweeps: 0,
    },
  };

  function _retryId426(url, ts) {
    return createHash('sha256').update(url + ts + Math.random()).digest('hex').slice(0, 16);
  }

  function _retryFile426() {
    if (!_retryQueue426.dataDir) return null;
    const dir = path.join(_retryQueue426.dataDir, 'webhook_retry');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'retry_queue.jsonl');
  }

  function _appendRetryLog426(entry) {
    if (_retryQueue426.log.length >= MAX_RETRY_LOG426) _retryQueue426.log.shift();
    _retryQueue426.log.push(entry);
    const file = _retryFile426();
    if (file) {
      try { fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8'); } catch (_) {}
    }
  }

  /**
   * enqueueWebhookRetry426(url, payload, opts) — add a failed webhook to the retry queue.
   */
  function enqueueWebhookRetry426(url, payload, opts = {}, auditLog = null) {
    if (!url) throw new Error('url required');
    if (_retryQueue426.queue.length >= MAX_RETRY_QUEUE426) {
      throw new Error('Retry queue full (max ' + MAX_RETRY_QUEUE426 + ')');
    }
    const retryId = _retryId426(url, new Date().toISOString());
    const entry = {
      retryId,
      url,
      payload: payload || {},
      maxAttempts: opts.maxAttempts !== undefined ? parseInt(opts.maxAttempts, 10) : DEFAULT_MAX_ATTEMPTS426,
      baseDelayMs: opts.baseDelayMs !== undefined ? parseInt(opts.baseDelayMs, 10) : DEFAULT_BASE_DELAY_MS426,
      maxDelayMs: opts.maxDelayMs !== undefined ? parseInt(opts.maxDelayMs, 10) : DEFAULT_MAX_DELAY_MS426,
      attempts: 0,
      nextAttemptAt: new Date().toISOString(),
      status: 'pending',
      createdAt: new Date().toISOString(),
      lastError: null,
    };
    _retryQueue426.queue.push(entry);
    _retryQueue426.stats.enqueued++;
    if (auditLog && typeof auditLog.log === 'function') {
      auditLog.log('webhook_retry_enqueue426', { retryId, url, maxAttempts: entry.maxAttempts });
    }
    return { ok: true, retryId, maxAttempts: entry.maxAttempts };
  }

  function _calcNextDelay426(attempts, baseDelayMs, maxDelayMs) {
    const delay = Math.min(baseDelayMs * Math.pow(2, attempts), maxDelayMs);
    return delay;
  }

  function _sendWebhook426(url, payload, timeoutMs) {
    return new Promise((resolve, reject) => {
      let parsed;
      try { parsed = new URL(url); } catch (e) { return reject(new Error('Invalid URL: ' + e.message)); }
      const body = JSON.stringify(payload);
      const opts = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + (parsed.search || ''),
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      };
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.request(opts, (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 300) resolve({ statusCode: res.statusCode });
        else reject(new Error('HTTP ' + res.statusCode));
      });
      req.on('error', reject);
      const timer = setTimeout(() => { req.destroy(); reject(new Error('timeout')); }, timeoutMs || 5000);
      req.on('close', () => clearTimeout(timer));
      req.write(body);
      req.end();
    });
  }

  /**
   * sweepRetryQueue426() — process pending retries whose nextAttemptAt <= now.
   */
  async function sweepRetryQueue426(auditLog = null) {
    const now = Date.now();
    _retryQueue426.stats.sweeps++;
    const pending = _retryQueue426.queue.filter(e =>
      e.status === 'pending' && new Date(e.nextAttemptAt).getTime() <= now
    );

    for (const entry of pending) {
      entry.attempts++;
      try {
        await _sendWebhook426(entry.url, entry.payload, 5000);
        entry.status = 'succeeded';
        _retryQueue426.stats.succeeded++;
        _appendRetryLog426({ event: 'webhook_retry_success426', retryId: entry.retryId, attempts: entry.attempts, ts: new Date().toISOString() });
        if (auditLog && typeof auditLog.log === 'function') {
          auditLog.log('webhook_retry_success426', { retryId: entry.retryId, attempts: entry.attempts });
        }
      } catch (e) {
        entry.lastError = e.message;
        if (entry.attempts >= entry.maxAttempts) {
          entry.status = 'abandoned';
          _retryQueue426.stats.abandoned++;
          _appendRetryLog426({ event: 'webhook_retry_abandoned426', retryId: entry.retryId, attempts: entry.attempts, lastError: e.message, ts: new Date().toISOString() });
          if (auditLog && typeof auditLog.log === 'function') {
            auditLog.log('webhook_retry_abandoned426', { retryId: entry.retryId, attempts: entry.attempts });
          }
        } else {
          const delay = _calcNextDelay426(entry.attempts, entry.baseDelayMs, entry.maxDelayMs);
          entry.nextAttemptAt = new Date(now + delay).toISOString();
          _retryQueue426.stats.failed++;
          _appendRetryLog426({ event: 'webhook_retry_fail426', retryId: entry.retryId, attempts: entry.attempts, nextAttemptAt: entry.nextAttemptAt, lastError: e.message, ts: new Date().toISOString() });
        }
      }
    }

    // Remove completed entries
    _retryQueue426.queue = _retryQueue426.queue.filter(e => e.status === 'pending');
    return { swept: pending.length, remaining: _retryQueue426.queue.length };
  }

  function getRetryQueueStatus426() {
    return {
      version: WEBHOOK_RETRY_VERSION426,
      pending: _retryQueue426.queue.length,
      stats: { ..._retryQueue426.stats },
      recentLog: _retryQueue426.log.slice(-20),
    };
  }

  function getRetryQueueItems426() {
    return _retryQueue426.queue.map(e => ({
      retryId: e.retryId,
      url: e.url,
      attempts: e.attempts,
      maxAttempts: e.maxAttempts,
      nextAttemptAt: e.nextAttemptAt,
      status: e.status,
      createdAt: e.createdAt,
      lastError: e.lastError,
    }));
  }

  function startRetryWorker426(auditLog = null) {
    if (_retryQueue426.sweepHandle) return { ok: false, error: 'already running' };
    _retryQueue426.sweepHandle = setInterval(async () => {
      try { await sweepRetryQueue426(auditLog); } catch (_) {}
    }, RETRY_SWEEP_MS426);
    return { ok: true, intervalMs: RETRY_SWEEP_MS426 };
  }

  function stopRetryWorker426() {
    if (_retryQueue426.sweepHandle) {
      clearInterval(_retryQueue426.sweepHandle);
      _retryQueue426.sweepHandle = null;
      return { ok: true, stopped: true };
    }
    return { ok: true, stopped: false };
  }

  function configureRetryDataDir426(dataDir) {
    _retryQueue426.dataDir = dataDir;
  }

  function wireWebhookRetryQueue426(app, opts = {}, auditLog = null) {
    if (opts.dataDir) configureRetryDataDir426(opts.dataDir);
    startRetryWorker426(auditLog);

    /* POST /api/v1/alerts/webhook/retry/enqueue */
    app.post('/api/v1/alerts/webhook/retry/enqueue', (req, res) => {
      try {
        const { url, payload, maxAttempts, baseDelayMs, maxDelayMs } = req.body || {};
        if (!url) return res.status(400).json({ ok: false, error: 'url required', ecosVersion: 'V426' });
        const result = enqueueWebhookRetry426(url, payload, { maxAttempts, baseDelayMs, maxDelayMs }, auditLog);
        res.json({ ok: true, ecosVersion: 'V426', ...result });
      } catch (e) {
        res.status(400).json({ ok: false, error: e.message, ecosVersion: 'V426' });
      }
    });

    /* POST /api/v1/alerts/webhook/retry/sweep */
    app.post('/api/v1/alerts/webhook/retry/sweep', async (_req, res) => {
      try {
        const result = await sweepRetryQueue426(auditLog);
        res.json({ ok: true, ecosVersion: 'V426', ...result });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V426' });
      }
    });

    /* GET /api/v1/alerts/webhook/retry/status */
    app.get('/api/v1/alerts/webhook/retry/status', (_req, res) => {
      res.json({ ok: true, ecosVersion: 'V426', ...getRetryQueueStatus426() });
    });

    /* GET /api/v1/alerts/webhook/retry/queue */
    app.get('/api/v1/alerts/webhook/retry/queue', (_req, res) => {
      res.json({ ok: true, ecosVersion: 'V426', items: getRetryQueueItems426(), count: _retryQueue426.queue.length });
    });

    /* POST /api/v1/alerts/webhook/retry/worker/start */
    app.post('/api/v1/alerts/webhook/retry/worker/start', (_req, res) => {
      const result = startRetryWorker426(auditLog);
      res.json({ ok: true, ecosVersion: 'V426', ...result });
    });

    /* POST /api/v1/alerts/webhook/retry/worker/stop */
    app.post('/api/v1/alerts/webhook/retry/worker/stop', (_req, res) => {
      const result = stopRetryWorker426();
      res.json({ ok: true, ecosVersion: 'V426', ...result });
    });
  }

  if (process.env.NODE_ENV === 'test') {
    module.exports = {
      enqueueWebhookRetry426,
      sweepRetryQueue426,
      getRetryQueueStatus426,
      getRetryQueueItems426,
      startRetryWorker426,
      stopRetryWorker426,
      configureRetryDataDir426,
      wireWebhookRetryQueue426,
      WEBHOOK_RETRY_VERSION426,
      DEFAULT_MAX_ATTEMPTS426,
      DEFAULT_BASE_DELAY_MS426,
      _retryQueue426,
      _calcNextDelay426,
    };
  } else {
    module.exports = {
      enqueueWebhookRetry426,
      sweepRetryQueue426,
      getRetryQueueStatus426,
      getRetryQueueItems426,
      startRetryWorker426,
      stopRetryWorker426,
      configureRetryDataDir426,
      wireWebhookRetryQueue426,
      WEBHOOK_RETRY_VERSION426,
      DEFAULT_MAX_ATTEMPTS426,
      DEFAULT_BASE_DELAY_MS426,
    };
  }
  