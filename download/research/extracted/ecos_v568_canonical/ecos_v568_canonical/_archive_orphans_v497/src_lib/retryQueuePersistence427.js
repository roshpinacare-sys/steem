'use strict';
  /**
   * retryQueuePersistence427.js — ECOS V427 Feature 2
   * Persists the entire webhook retry queue to JSONL on enqueue/sweep so
   * entries survive process restarts; loads persisted queue on startup.
   * R1: sacred files untouched. R2: all identifiers end in 427. R3: no new npm deps.
   */

  const fs = require('fs');
  const path = require('path');
  const { createHash } = require('crypto');

  const RETRY_PERSISTENCE_VERSION427 = '427.0.0';
  const MAX_PERSISTENCE_LOG427 = 500;
  const MAX_QUEUE_FILE_LINES427 = 2000;

  const _persistenceState427 = {
    dataDir: null,
    file: null,
    inMemoryQueue: [],     // mirror of persisted queue entries
    log: [],
    stats: {
      loadsRun: 0,
      flushesRun: 0,
      compactsRun: 0,
      entriesLoaded: 0,
      entriesWritten: 0,
      version: RETRY_PERSISTENCE_VERSION427,
    },
  };

  function _persistenceFile427() {
    if (!_persistenceState427.dataDir) return null;
    const dir = path.join(_persistenceState427.dataDir, 'webhook_retry');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'retry_queue_persist427.jsonl');
  }

  function _appendPersistLog427(entry) {
    if (_persistenceState427.log.length >= MAX_PERSISTENCE_LOG427) _persistenceState427.log.shift();
    _persistenceState427.log.push(entry);
  }

  /**
   * configureRetryPersistence427(opts) — set dataDir for persistence.
   */
  function configureRetryPersistence427(opts = {}) {
    if (opts.dataDir !== undefined) {
      _persistenceState427.dataDir = opts.dataDir;
      _persistenceState427.file = _persistenceFile427();
    }
    return { ok: true, dataDir: _persistenceState427.dataDir, file: _persistenceState427.file };
  }

  /**
   * loadRetryQueue427(dataDir?) — load persisted queue entries from JSONL on startup.
   */
  function loadRetryQueue427(dataDir = null, auditLog = null) {
    if (dataDir) _persistenceState427.dataDir = dataDir;
    const file = _persistenceFile427();
    if (!file) return { ok: false, reason: 'no dataDir configured' };

    _persistenceState427.stats.loadsRun++;
    let loaded = 0;

    if (!fs.existsSync(file)) {
      return { ok: true, loaded: 0, reason: 'no file yet' };
    }

    try {
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim());
      _persistenceState427.inMemoryQueue = [];
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry && entry.retryId427 && entry.status === 'pending') {
            _persistenceState427.inMemoryQueue.push(entry);
            loaded++;
          }
        } catch (_) {}
      }
      _persistenceState427.stats.entriesLoaded += loaded;
      _appendPersistLog427({ event: 'queue_loaded427', loaded, ts: new Date().toISOString() });
      if (auditLog && typeof auditLog.log === 'function') {
        auditLog.log('retry_queue_loaded427', { loaded, file });
      }
      return { ok: true, loaded, file };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /**
   * persistQueueEntry427(entry) — append a single queue entry to JSONL.
   */
  function persistQueueEntry427(entry) {
    if (!entry) return;
    const file = _persistenceFile427();
    if (!file) return;

    const record = {
      retryId427: entry.retryId || entry.retryId427,
      url: entry.url,
      payload: entry.payload,
      maxAttempts: entry.maxAttempts,
      baseDelayMs: entry.baseDelayMs,
      maxDelayMs: entry.maxDelayMs,
      attempts: entry.attempts,
      nextAttemptAt: entry.nextAttemptAt,
      status: entry.status,
      createdAt: entry.createdAt,
      persistedAt427: new Date().toISOString(),
    };

    // Update in-memory mirror
    const idx = _persistenceState427.inMemoryQueue.findIndex(e => e.retryId427 === record.retryId427);
    if (idx >= 0) _persistenceState427.inMemoryQueue[idx] = record;
    else _persistenceState427.inMemoryQueue.push(record);

    try {
      fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf8');
      _persistenceState427.stats.entriesWritten++;
    } catch (_) {}
  }

  /**
   * flushRetryQueue427(queueEntries) — write entire queue to JSONL (snapshot flush).
   */
  function flushRetryQueue427(queueEntries = [], auditLog = null) {
    const file = _persistenceFile427();
    if (!file) return { ok: false, reason: 'no dataDir configured' };

    _persistenceState427.stats.flushesRun++;
    const pending = (queueEntries || []).filter(e => e.status === 'pending');
    const content = pending.map(e => JSON.stringify({
      retryId427: e.retryId || e.retryId427,
      url: e.url,
      payload: e.payload,
      maxAttempts: e.maxAttempts,
      baseDelayMs: e.baseDelayMs,
      maxDelayMs: e.maxDelayMs,
      attempts: e.attempts,
      nextAttemptAt: e.nextAttemptAt,
      status: e.status,
      createdAt: e.createdAt,
      flushedAt427: new Date().toISOString(),
    })).join('\n') + (pending.length ? '\n' : '');

    try {
      fs.writeFileSync(file, content, 'utf8');
      _persistenceState427.inMemoryQueue = pending.map(e => ({
        retryId427: e.retryId || e.retryId427,
        status: e.status,
        url: e.url,
      }));
      _persistenceState427.stats.entriesWritten += pending.length;
      _appendPersistLog427({ event: 'queue_flushed427', count: pending.length, ts: new Date().toISOString() });
      if (auditLog && typeof auditLog.log === 'function') {
        auditLog.log('retry_queue_flushed427', { count: pending.length });
      }
      return { ok: true, written: pending.length, file };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /**
   * compactRetryQueue427() — atomically rewrite JSONL keeping only pending entries.
   */
  function compactRetryQueue427(auditLog = null) {
    const file = _persistenceFile427();
    if (!file || !fs.existsSync(file)) return { ok: false, reason: 'no file to compact' };

    _persistenceState427.stats.compactsRun++;

    try {
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim());
      const seen = new Map();
      for (const line of lines) {
        try {
          const e = JSON.parse(line);
          if (e && e.retryId427) seen.set(e.retryId427, e); // last write wins
        } catch (_) {}
      }
      const pending = [...seen.values()].filter(e => e.status === 'pending');
      const content = pending.map(e => JSON.stringify(e)).join('\n') + (pending.length ? '\n' : '');
      const tmp = file + '.tmp427';
      fs.writeFileSync(tmp, content, 'utf8');
      fs.renameSync(tmp, file);

      const removed = lines.length - pending.length;
      _appendPersistLog427({ event: 'queue_compacted427', retained: pending.length, removed, ts: new Date().toISOString() });
      if (auditLog && typeof auditLog.log === 'function') {
        auditLog.log('retry_queue_compacted427', { retained: pending.length, removed });
      }
      return { ok: true, retained: pending.length, removed };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  function getRetryPersistenceStatus427() {
    const file = _persistenceFile427();
    let fileBytes = 0;
    let fileLines = 0;
    if (file && fs.existsSync(file)) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        fileBytes = Buffer.byteLength(content, 'utf8');
        fileLines = content.split('\n').filter(l => l.trim()).length;
      } catch (_) {}
    }
    return {
      version: RETRY_PERSISTENCE_VERSION427,
      dataDir: _persistenceState427.dataDir,
      file,
      fileExists: !!(file && fs.existsSync(file)),
      fileBytes,
      fileLines,
      inMemoryCount: _persistenceState427.inMemoryQueue.length,
      stats: { ..._persistenceState427.stats },
      recentLog: _persistenceState427.log.slice(-10),
    };
  }

  function wireRetryQueuePersistence427(app, opts = {}, auditLog = null) {
    if (opts.dataDir) configureRetryPersistence427({ dataDir: opts.dataDir });

    /* POST /api/v1/alerts/webhook/retry/persistence/load */
    app.post('/api/v1/alerts/webhook/retry/persistence/load', (req, res) => {
      try {
        const { dataDir } = req.body || {};
        const result = loadRetryQueue427(dataDir, auditLog);
        res.json({ ok: true, ecosVersion: 'V427', ...result });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V427' });
      }
    });

    /* GET /api/v1/alerts/webhook/retry/persistence/status */
    app.get('/api/v1/alerts/webhook/retry/persistence/status', (_req, res) => {
      res.json({ ok: true, ecosVersion: 'V427', ...getRetryPersistenceStatus427() });
    });

    /* POST /api/v1/alerts/webhook/retry/persistence/flush */
    app.post('/api/v1/alerts/webhook/retry/persistence/flush', (req, res) => {
      try {
        const { queue } = req.body || {};
        const result = flushRetryQueue427(Array.isArray(queue) ? queue : [], auditLog);
        res.json({ ok: true, ecosVersion: 'V427', ...result });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V427' });
      }
    });

    /* POST /api/v1/alerts/webhook/retry/persistence/compact */
    app.post('/api/v1/alerts/webhook/retry/persistence/compact', (_req, res) => {
      try {
        const result = compactRetryQueue427(auditLog);
        res.json({ ok: true, ecosVersion: 'V427', ...result });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V427' });
      }
    });

    /* GET /api/v1/alerts/webhook/retry/persistence/stats */
    app.get('/api/v1/alerts/webhook/retry/persistence/stats', (_req, res) => {
      res.json({ ok: true, ecosVersion: 'V427', ...getRetryPersistenceStatus427() });
    });
  }

  if (process.env.NODE_ENV === 'test') {
    module.exports = {
      configureRetryPersistence427,
      loadRetryQueue427,
      persistQueueEntry427,
      flushRetryQueue427,
      compactRetryQueue427,
      getRetryPersistenceStatus427,
      wireRetryQueuePersistence427,
      RETRY_PERSISTENCE_VERSION427,
      _persistenceState427,
    };
  } else {
    module.exports = {
      configureRetryPersistence427,
      loadRetryQueue427,
      persistQueueEntry427,
      flushRetryQueue427,
      compactRetryQueue427,
      getRetryPersistenceStatus427,
      wireRetryQueuePersistence427,
      RETRY_PERSISTENCE_VERSION427,
    };
  }
  