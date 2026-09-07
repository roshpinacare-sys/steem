'use strict';
  /**
   * exportScheduler426.js — ECOS V426 Feature 5
   * Background job that auto-exports audit ledger on configurable intervals
   * (e.g. daily CSV to disk). Tracks last export time and file size.
   * R1: sacred files untouched. R2: all identifiers end in 426. R3: no new npm deps.
   */

  const fs = require('fs');
  const path = require('path');
  const { createHash } = require('crypto');

  const EXPORT_SCHEDULER_VERSION426 = '426.0.0';
  const DEFAULT_INTERVAL_MS426 = 24 * 60 * 60 * 1000;  // 24h
  const MAX_SCHEDULE_LOG426 = 500;
  const MIN_INTERVAL_MS426 = 60 * 1000;  // minimum 60s

  const _schedulerState426 = {
    handle: null,
    config: {
      intervalMs: DEFAULT_INTERVAL_MS426,
      format: 'csv',
      dataDir: null,
      enabled: true,
    },
    lastExport: null,
    log: [],
    stats: {
      exportsRun: 0,
      exportsFailed: 0,
      totalBytesWritten: 0,
    },
  };

  function _appendSchedulerLog426(entry) {
    if (_schedulerState426.log.length >= MAX_SCHEDULE_LOG426) _schedulerState426.log.shift();
    _schedulerState426.log.push(entry);
  }

  function _exportDir426() {
    const dir = path.join(_schedulerState426.config.dataDir || process.cwd(), 'audit_exports');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /**
   * configureExportScheduler426(opts) — configure interval, format, dataDir.
   */
  function configureExportScheduler426(opts = {}) {
    if (opts.intervalMs !== undefined) {
      const ms = parseInt(opts.intervalMs, 10);
      if (isNaN(ms) || ms < MIN_INTERVAL_MS426) throw new Error('intervalMs must be >= ' + MIN_INTERVAL_MS426);
      _schedulerState426.config.intervalMs = ms;
    }
    if (opts.format !== undefined) {
      if (!['csv', 'ndjson'].includes(opts.format)) throw new Error('format must be csv or ndjson');
      _schedulerState426.config.format = opts.format;
    }
    if (opts.dataDir !== undefined) _schedulerState426.config.dataDir = opts.dataDir;
    if (opts.enabled !== undefined) _schedulerState426.config.enabled = Boolean(opts.enabled);
    return { ok: true, config: { ..._schedulerState426.config } };
  }

  /**
   * runExport426(auditLedgerInstance, auditLog) — perform one scheduled export.
   * Returns { ok, filename, bytes, checksum, format, entryCount }.
   */
  function runExport426(auditLedgerInstance, auditLog = null) {
    if (!_schedulerState426.config.enabled) {
      return { ok: false, skipped: true, reason: 'scheduler disabled' };
    }

    let entries = [];
    try {
      if (auditLedgerInstance && typeof auditLedgerInstance.getEntries === 'function') {
        entries = auditLedgerInstance.getEntries() || [];
      } else if (auditLedgerInstance && Array.isArray(auditLedgerInstance.entries)) {
        entries = auditLedgerInstance.entries;
      } else if (Array.isArray(auditLedgerInstance)) {
        entries = auditLedgerInstance;
      }
    } catch (_) {}

    const format = _schedulerState426.config.format;
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const ext = format === 'ndjson' ? 'ndjson' : 'csv';
    const filename = `audit_export_${ts}.${ext}`;
    const dir = _exportDir426();
    const filePath = path.join(dir, filename);

    let content = '';
    if (format === 'csv') {
      const headers = ['entryId', 'ts', 'distributionType', 'totalAmount', 'entryHash'];
      content = headers.join(',') + '\n';
      for (const e of entries) {
        content += [
          e.entryId || '', e.ts || '', e.distributionType || '',
          e.totalAmount !== undefined ? e.totalAmount : '', e.entryHash || ''
        ].map(v => { const s = String(v); return s.includes(',') ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',') + '\n';
      }
    } else {
      content = entries.map(e => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : '');
    }

    fs.writeFileSync(filePath, content, 'utf8');
    const bytes = Buffer.byteLength(content, 'utf8');
    const checksum = createHash('sha256').update(content).digest('hex');

    _schedulerState426.stats.exportsRun++;
    _schedulerState426.stats.totalBytesWritten += bytes;

    const record = {
      event: 'scheduled_export426',
      filename,
      filePath,
      format,
      entryCount: entries.length,
      bytes,
      checksum,
      ts: new Date().toISOString(),
    };
    _schedulerState426.lastExport = record;
    _appendSchedulerLog426(record);

    if (auditLog && typeof auditLog.log === 'function') {
      auditLog.log('export_scheduler426', { filename, entryCount: entries.length, bytes, checksum });
    }

    return { ok: true, filename, filePath, bytes, checksum, format, entryCount: entries.length };
  }

  /**
   * startExportScheduler426(auditLedgerInstance, auditLog) — begin background export job.
   */
  function startExportScheduler426(auditLedgerInstance, auditLog = null) {
    if (_schedulerState426.handle) return { ok: false, error: 'already running' };
    _schedulerState426.handle = setInterval(() => {
      try { runExport426(auditLedgerInstance, auditLog); } catch (e) {
        _schedulerState426.stats.exportsFailed++;
        _appendSchedulerLog426({ event: 'export_fail426', error: e.message, ts: new Date().toISOString() });
      }
    }, _schedulerState426.config.intervalMs);
    return { ok: true, intervalMs: _schedulerState426.config.intervalMs };
  }

  function stopExportScheduler426() {
    if (_schedulerState426.handle) {
      clearInterval(_schedulerState426.handle);
      _schedulerState426.handle = null;
      return { ok: true, stopped: true };
    }
    return { ok: true, stopped: false };
  }

  function getExportSchedulerStatus426() {
    return {
      version: EXPORT_SCHEDULER_VERSION426,
      running: !!_schedulerState426.handle,
      config: { ..._schedulerState426.config },
      lastExport: _schedulerState426.lastExport,
      stats: { ..._schedulerState426.stats },
      recentLog: _schedulerState426.log.slice(-10),
    };
  }

  function wireExportScheduler426(app, auditLedgerInstance, opts = {}, auditLog = null) {
    if (opts.dataDir) _schedulerState426.config.dataDir = opts.dataDir;

    /* POST /api/v1/x402/distribute/audit/export/schedule/configure */
    app.post('/api/v1/x402/distribute/audit/export/schedule/configure', (req, res) => {
      try {
        const result = configureExportScheduler426(req.body || {});
        res.json({ ok: true, ecosVersion: 'V426', ...result });
      } catch (e) {
        res.status(400).json({ ok: false, error: e.message, ecosVersion: 'V426' });
      }
    });

    /* POST /api/v1/x402/distribute/audit/export/schedule/start */
    app.post('/api/v1/x402/distribute/audit/export/schedule/start', (_req, res) => {
      const result = startExportScheduler426(auditLedgerInstance, auditLog);
      res.json({ ok: true, ecosVersion: 'V426', ...result });
    });

    /* POST /api/v1/x402/distribute/audit/export/schedule/stop */
    app.post('/api/v1/x402/distribute/audit/export/schedule/stop', (_req, res) => {
      const result = stopExportScheduler426();
      res.json({ ok: true, ecosVersion: 'V426', ...result });
    });

    /* POST /api/v1/x402/distribute/audit/export/schedule/run */
    app.post('/api/v1/x402/distribute/audit/export/schedule/run', (_req, res) => {
      try {
        const result = runExport426(auditLedgerInstance, auditLog);
        res.json({ ok: true, ecosVersion: 'V426', ...result });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V426' });
      }
    });

    /* GET /api/v1/x402/distribute/audit/export/schedule/status */
    app.get('/api/v1/x402/distribute/audit/export/schedule/status', (_req, res) => {
      res.json({ ok: true, ecosVersion: 'V426', ...getExportSchedulerStatus426() });
    });

    /* GET /api/v1/x402/distribute/audit/export/schedule/log */
    app.get('/api/v1/x402/distribute/audit/export/schedule/log', (req, res) => {
      const limit = parseInt(req.query.limit, 10) || 50;
      const log = _schedulerState426.log.slice(-Math.min(limit, MAX_SCHEDULE_LOG426));
      res.json({ ok: true, ecosVersion: 'V426', count: log.length, log });
    });
  }

  if (process.env.NODE_ENV === 'test') {
    module.exports = {
      configureExportScheduler426,
      runExport426,
      startExportScheduler426,
      stopExportScheduler426,
      getExportSchedulerStatus426,
      wireExportScheduler426,
      EXPORT_SCHEDULER_VERSION426,
      DEFAULT_INTERVAL_MS426,
      MIN_INTERVAL_MS426,
      _schedulerState426,
    };
  } else {
    module.exports = {
      configureExportScheduler426,
      runExport426,
      startExportScheduler426,
      stopExportScheduler426,
      getExportSchedulerStatus426,
      wireExportScheduler426,
      EXPORT_SCHEDULER_VERSION426,
      DEFAULT_INTERVAL_MS426,
      MIN_INTERVAL_MS426,
    };
  }
  