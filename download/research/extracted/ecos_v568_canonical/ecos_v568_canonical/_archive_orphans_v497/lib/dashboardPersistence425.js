'use strict';
/**
 * dashboardPersistence425.js — ECOS V425 Feature 1
 * Persists dashboard render history to JSONL WAL; supports time-range queries
 * for replaying telemetry snapshots.
 * R1: sacred files untouched. R2: all identifiers end in 425. R3: no new npm deps.
 */

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

const DASHBOARD_PERSISTENCE_VERSION425 = '425.0.0';
const MAX_RENDER_HISTORY425 = 10000;

class DashboardPersistence425 {
  constructor(opts = {}) {
    this._dataDir = opts.dataDir || path.join(process.cwd(), '.ecos_data');
    this._audit = opts.audit || null;
    this._file = null;
    this._renders = [];
    this._stats425 = {
      version: DASHBOARD_PERSISTENCE_VERSION425,
      rendersLoaded: 0,
      rendersAppended: 0,
      queriesServed: 0,
      compactions: 0,
    };
  }

  _ensureDir425() {
    const dir = path.join(this._dataDir, 'dashboard');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!this._file) this._file = path.join(dir, 'renders.jsonl');
  }

  /** Append a render record to JSONL. O(1) write. */
  persistRender425(renderEntry) {
    if (!renderEntry || typeof renderEntry !== 'object') throw new Error('renderEntry must be an object');
    this._ensureDir425();
    const record = {
      type: 'render425',
      ts: renderEntry.ts || new Date().toISOString(),
      intent: renderEntry.intent || 'unknown',
      totalEntries: renderEntry.totalEntries || 0,
      renderHash: createHash('sha256')
        .update(JSON.stringify(renderEntry))
        .digest('hex')
        .slice(0, 16),
      meta: renderEntry.meta || {},
    };
    fs.appendFileSync(this._file, JSON.stringify(record) + '\n', 'utf8');
    this._renders.push(record);
    if (this._renders.length > MAX_RENDER_HISTORY425) this._renders.shift();
    this._stats425.rendersAppended++;
    if (this._audit && typeof this._audit.log === 'function') {
      this._audit.log('dashboard.persistence.persist425', { ts: record.ts, renderHash: record.renderHash });
    }
    return { ok: true, renderHash: record.renderHash };
  }

  /** Query renders within a time range (ISO strings). */
  queryByTimeRange425(fromTs, toTs) {
    this._stats425.queriesServed++;
    const from = fromTs ? new Date(fromTs).getTime() : 0;
    const to = toTs ? new Date(toTs).getTime() : Infinity;
    const results = this._renders.filter(r => {
      const t = new Date(r.ts).getTime();
      return t >= from && t <= to;
    });
    return { ok: true, count: results.length, entries: results };
  }

  /** Replay all renders from disk (startup). */
  loadAll425() {
    this._ensureDir425();
    let loaded = 0;
    const errors = [];
    if (!fs.existsSync(this._file)) return { rendersLoaded: 0, errors: [] };
    const lines = fs.readFileSync(this._file, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const rec = JSON.parse(line);
        if (rec.type === 'render425') {
          this._renders.push(rec);
          loaded++;
        }
      } catch (e) {
        errors.push(e.message);
      }
    }
    // Keep only last MAX_RENDER_HISTORY425
    if (this._renders.length > MAX_RENDER_HISTORY425) {
      this._renders = this._renders.slice(-MAX_RENDER_HISTORY425);
    }
    this._stats425.rendersLoaded = loaded;
    if (this._audit && typeof this._audit.log === 'function') {
      this._audit.log('dashboard.persistence.load425', { rendersLoaded: loaded, errors: errors.length });
    }
    return { rendersLoaded: loaded, errors };
  }

  /** Compact JSONL — keep only last MAX_RENDER_HISTORY425 live entries. */
  compact425() {
    this._ensureDir425();
    const live = this._renders.slice(-MAX_RENDER_HISTORY425);
    const tmp = this._file + '.tmp';
    fs.writeFileSync(tmp, live.map(r => JSON.stringify(r)).join('\n') + (live.length ? '\n' : ''), 'utf8');
    fs.renameSync(tmp, this._file);
    this._stats425.compactions++;
    if (this._audit && typeof this._audit.log === 'function') {
      this._audit.log('dashboard.persistence.compact425', { kept: live.length });
    }
    return { ok: true, kept: live.length };
  }

  stats425() {
    return {
      ...this._stats425,
      liveRenders: this._renders.length,
      dataDir: this._dataDir,
      file: this._file,
    };
  }
}

function wireDashboardPersistence425(app, opts = {}) {
  const store = new DashboardPersistence425(opts);
  try { store.loadAll425(); } catch (_) {}

  /* POST /api/v1/chat/route/telemetry/dashboard/persist */
  app.post('/api/v1/chat/route/telemetry/dashboard/persist', (req, res) => {
    try {
      const body = req.body || {};
      const result = store.persistRender425(body);
      res.json({ ok: true, ecosVersion: 'V425', ...result });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message, ecosVersion: 'V425' });
    }
  });

  /* GET /api/v1/chat/route/telemetry/dashboard/history */
  app.get('/api/v1/chat/route/telemetry/dashboard/history', (req, res) => {
    try {
      const { from, to, limit } = req.query;
      const result = store.queryByTimeRange425(from || null, to || null);
      const lim = parseInt(limit, 10) || 100;
      result.entries = result.entries.slice(-lim);
      result.count = result.entries.length;
      res.json({ ok: true, ecosVersion: 'V425', ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V425' });
    }
  });

  /* GET /api/v1/chat/route/telemetry/dashboard/persistence/stats */
  app.get('/api/v1/chat/route/telemetry/dashboard/persistence/stats', (_req, res) => {
    res.json({ ok: true, ecosVersion: 'V425', ...store.stats425() });
  });

  /* POST /api/v1/chat/route/telemetry/dashboard/persistence/compact */
  app.post('/api/v1/chat/route/telemetry/dashboard/persistence/compact', (_req, res) => {
    try {
      res.json({ ok: true, ecosVersion: 'V425', ...store.compact425() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message, ecosVersion: 'V425' });
    }
  });

  return store;
}

if (process.env.NODE_ENV === 'test') {
  module.exports = {
    DashboardPersistence425,
    wireDashboardPersistence425,
    DASHBOARD_PERSISTENCE_VERSION425,
  };
} else {
  module.exports = {
    DashboardPersistence425,
    wireDashboardPersistence425,
    DASHBOARD_PERSISTENCE_VERSION425,
  };
}
