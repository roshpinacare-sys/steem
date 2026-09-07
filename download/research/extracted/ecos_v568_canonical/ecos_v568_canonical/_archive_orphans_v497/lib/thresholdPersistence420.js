'use strict';
/**
 * src/lib/thresholdPersistence420.js — ECOS V420 (Phase P308) — Threshold Persistence
 *
 * Persists AdaptiveThresholdEngine417 calibrated thresholds to a JSONL file
 * so that recalibration state survives server restarts.
 *
 * Architecture:
 *   AdaptiveThresholdEngine417 ←→ ThresholdPersistence420
 *       ↓ calibrate / recalibrate events       ↑ replay on startup
 *   {dataDir}/thresholds/thresholds.jsonl    WAL-style append-only log
 *
 * Design:
 *  - One JSONL file at {dataDir}/thresholds/thresholds.jsonl
 *  - Each line is a JSON record: { op: 'upsert'|'reset', topic, thresholds, ts }
 *  - On startup: replay all lines, last-write-wins per topic key
 *  - On upsert: append a single JSON line (O(1), no rewrite)
 *  - On reset: append a reset record that clears all overrides
 *  - Compaction: rewrite file keeping only the latest state per topic
 *  - Thread safety: single-process; file ops are synchronous
 *
 * All identifiers end in 420 (R2). No new npm deps (R3). Sacred untouched (R1).
 * Zero new module-level singletons outside wire420 IIFE (R7).
 *
 * @version 420.0.0
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const PERSISTENCE_VERSION_420 = '420.0.0';
const THRESHOLDS_SUBDIR_420   = 'thresholds';
const THRESHOLDS_FILE_420     = 'thresholds.jsonl';
const MAX_TOPIC_KEY_LEN_420   = 256;

// ── Helpers ───────────────────────────────────────────────────────────────────

function sanitizeTopic420(topic) {
  if (topic === '__global__') return '__global__';
  if (typeof topic !== 'string' || !topic.trim()) throw new Error('topic must be a non-empty string (420)');
  if (topic.length > MAX_TOPIC_KEY_LEN_420) throw new Error('topic key too long (420)');
  return topic;
}

function validateThresholds420(thresholds) {
  if (typeof thresholds !== 'object' || thresholds === null || Array.isArray(thresholds)) {
    throw new Error('thresholds must be a plain object (420)');
  }
  const allowed = new Set(['hedgeThreshold', 'sycophancyThreshold', 'trimThreshold', 'groundingBoost']);
  for (const [k, v] of Object.entries(thresholds)) {
    if (!allowed.has(k)) throw new Error(`unknown threshold key: ${k} (420)`);
    if (typeof v !== 'number' || !isFinite(v)) throw new Error(`threshold ${k} must be a finite number (420)`);
  }
  return thresholds;
}

// ── ThresholdPersistence420 ───────────────────────────────────────────────────

class ThresholdPersistence420 {
  /**
   * @param {object} opts
   * @param {string}   opts.dataDir  - base data directory (thresholds/ will be created inside)
   * @param {function} [opts.audit]  - audit(type, data) hook
   */
  constructor(opts = {}) {
    if (!opts.dataDir) throw new Error('ThresholdPersistence420 requires opts.dataDir (420)');
    this._dataDir   = opts.dataDir;
    this._threshDir = path.join(opts.dataDir, THRESHOLDS_SUBDIR_420);
    this._file      = path.join(this._threshDir, THRESHOLDS_FILE_420);
    this._audit     = typeof opts.audit === 'function' ? opts.audit : null;

    // In-memory replica: { [topic]: { thresholds, ts } }
    this._replica420 = {};
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  _ensureDir420() {
    if (!fs.existsSync(this._threshDir)) {
      fs.mkdirSync(this._threshDir, { recursive: true });
    }
  }

  _appendLine420(record) {
    this._ensureDir420();
    fs.appendFileSync(this._file, JSON.stringify(record) + '\n', 'utf8');
  }

  _emit420(type, data) {
    if (this._audit) {
      try { this._audit(type, data); } catch (_) { /* audit errors must never break persistence */ }
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Startup replay — read the JSONL file and rebuild in-memory state.
   * @returns {{ topicsLoaded: number, recordsReplayed: number, errors: string[] }}
   */
  loadAll420() {
    const result = { topicsLoaded: 0, recordsReplayed: 0, errors: [] };
    this._replica420 = {};

    if (!fs.existsSync(this._file)) {
      this._emit420('threshold.persistence.load420', { status: 'empty', ...result });
      return result;
    }

    let raw;
    try {
      raw = fs.readFileSync(this._file, 'utf8');
    } catch (err) {
      result.errors.push(`read error: ${err.message}`);
      this._emit420('threshold.persistence.load420', { status: 'error', ...result });
      return result;
    }

    const lines = raw.split('\n').filter(l => l.trim());
    for (const line of lines) {
      result.recordsReplayed++;
      try {
        const rec = JSON.parse(line);
        if (rec.op === 'reset') {
          // Reset: clear all topics
          this._replica420 = {};
        } else if (rec.op === 'upsert' && rec.topic) {
          // Last-write-wins per topic
          this._replica420[rec.topic] = { thresholds: rec.thresholds, ts: rec.ts };
        }
      } catch (err) {
        result.errors.push(`parse error line ${result.recordsReplayed}: ${err.message}`);
      }
    }

    result.topicsLoaded = Object.keys(this._replica420).length;
    this._emit420('threshold.persistence.load420', { status: 'ok', ...result });
    return result;
  }

  /**
   * Persist thresholds for a topic (or '__global__' for global thresholds).
   * @param {string} topic
   * @param {object} thresholds
   */
  upsert420(topic, thresholds) {
    const safeTopic = sanitizeTopic420(topic);
    const safeThresholds = validateThresholds420(thresholds);
    const ts = Date.now();

    const record = { op: 'upsert', topic: safeTopic, thresholds: safeThresholds, ts };
    this._appendLine420(record);
    this._replica420[safeTopic] = { thresholds: safeThresholds, ts };

    this._emit420('threshold.persistence.upsert420', { topic: safeTopic, ts });
    return { ok: true, topic: safeTopic, ts };
  }

  /**
   * Reset all persisted thresholds (writes a reset tombstone).
   */
  reset420() {
    const ts = Date.now();
    const record = { op: 'reset', ts };
    this._appendLine420(record);
    this._replica420 = {};

    this._emit420('threshold.persistence.reset420', { ts });
    return { ok: true, ts };
  }

  /**
   * Get persisted thresholds for a topic, or null if not found.
   * @param {string} topic
   * @returns {{ thresholds: object, ts: number } | null}
   */
  get420(topic) {
    const safeTopic = sanitizeTopic420(topic);
    return this._replica420[safeTopic] || null;
  }

  /**
   * List all persisted topics.
   * @returns {string[]}
   */
  list420() {
    return Object.keys(this._replica420);
  }

  /**
   * Compact the JSONL file — rewrite keeping only the latest state per topic.
   * Uses atomic .tmp + rename to avoid corruption.
   * @returns {{ ok: boolean, topicsWritten: number, bytesWritten: number }}
   */
  compact420() {
    this._ensureDir420();
    const live = this._replica420;
    const lines = [];

    for (const [topic, entry] of Object.entries(live)) {
      lines.push(JSON.stringify({ op: 'upsert', topic, thresholds: entry.thresholds, ts: entry.ts }));
    }

    const content = lines.join('\n') + (lines.length ? '\n' : '');
    const tmpFile = this._file + '.tmp';

    fs.writeFileSync(tmpFile, content, 'utf8');
    fs.renameSync(tmpFile, this._file);

    const bytesWritten = Buffer.byteLength(content, 'utf8');
    this._emit420('threshold.persistence.compact420', { topicsWritten: lines.length, bytesWritten });
    return { ok: true, topicsWritten: lines.length, bytesWritten };
  }

  /**
   * Global stats snapshot.
   * @returns {{ totalTopics: number, dataDir: string, file: string, version: string }}
   */
  stats420() {
    return {
      totalTopics: Object.keys(this._replica420).length,
      dataDir:     this._dataDir,
      file:        this._file,
      version:     PERSISTENCE_VERSION_420,
    };
  }
}

// ── wire420 IIFE ─────────────────────────────────────────────────────────────

/**
 * wire420({ app, logger, audit, dataDir })
 *
 * Mounts 7 Express endpoints:
 *   POST   /api/v1/thresholds/upsert           [T01] persist topic thresholds
 *   GET    /api/v1/thresholds/list             [T02] list persisted topics
 *   GET    /api/v1/thresholds/:topic           [T03] get thresholds for topic
 *   POST   /api/v1/thresholds/reset            [T04] reset all persisted thresholds
 *   POST   /api/v1/thresholds/compact          [T05] compact the JSONL file
 *   GET    /api/v1/thresholds/stats            [T06] global persistence stats
 *   GET    /api/v1/admin/summary/v420          [T07] V420 module summary
 */
function wire420({ app, logger, audit, dataDir }) {
  if (!app)     throw new Error('wire420 requires app (420)');
  if (!dataDir) throw new Error('wire420 requires dataDir (420)');

  const log420    = logger  || { info: () => {}, error: () => {} };
  const audit420  = typeof audit === 'function' ? audit : null;
  const store420  = new ThresholdPersistence420({ dataDir, audit: audit420 });

  // Startup replay
  const loadResult420 = store420.loadAll420();
  log420.info({ msg: 'ThresholdPersistence420 loaded', ...loadResult420 });

  // ── T01: Upsert thresholds for a topic ─────────────────────────────────────
  app.post('/api/v1/thresholds/upsert', (req, res) => {
    try {
      const { topic, thresholds } = req.body || {};
      if (!topic)      return res.status(400).json({ error: 'topic required (420)' });
      if (!thresholds) return res.status(400).json({ error: 'thresholds required (420)' });
      const result = store420.upsert420(topic, thresholds);
      return res.json(result);
    } catch (err) {
      log420.error({ msg: 'upsert420 error', err: err.message });
      return res.status(400).json({ error: err.message });
    }
  });

  // ── T02: List persisted topics ──────────────────────────────────────────────
  app.get('/api/v1/thresholds/list', (_req, res) => {
    try {
      const topics = store420.list420();
      return res.json({ topics, count: topics.length });
    } catch (err) {
      log420.error({ msg: 'list420 error', err: err.message });
      return res.status(500).json({ error: err.message });
    }
  });

  // ── T03: Get thresholds for a topic ────────────────────────────────────────
  app.get('/api/v1/thresholds/:topic', (req, res) => {
    try {
      const topic = req.params.topic;
      const entry = store420.get420(topic);
      if (!entry) return res.status(404).json({ error: 'topic not found (420)' });
      return res.json({ topic, ...entry });
    } catch (err) {
      log420.error({ msg: 'get420 error', err: err.message });
      return res.status(400).json({ error: err.message });
    }
  });

  // ── T04: Reset all persisted thresholds ────────────────────────────────────
  app.post('/api/v1/thresholds/reset', (_req, res) => {
    try {
      const result = store420.reset420();
      return res.json(result);
    } catch (err) {
      log420.error({ msg: 'reset420 error', err: err.message });
      return res.status(500).json({ error: err.message });
    }
  });

  // ── T05: Compact the JSONL file ────────────────────────────────────────────
  app.post('/api/v1/thresholds/compact', (_req, res) => {
    try {
      const result = store420.compact420();
      return res.json(result);
    } catch (err) {
      log420.error({ msg: 'compact420 error', err: err.message });
      return res.status(500).json({ error: err.message });
    }
  });

  // ── T06: Global persistence stats ──────────────────────────────────────────
  app.get('/api/v1/thresholds/stats', (_req, res) => {
    try {
      return res.json(store420.stats420());
    } catch (err) {
      log420.error({ msg: 'stats420 error', err: err.message });
      return res.status(500).json({ error: err.message });
    }
  });

  // ── T07: V420 admin summary ────────────────────────────────────────────────
  app.get('/api/v1/admin/summary/v420', (_req, res) => {
    const stats = store420.stats420();
    return res.json({
      version:   '420.0.0',
      module:    'ThresholdPersistence420',
      endpoints: 7,
      theme:     'Adaptive Threshold Persistence',
      stats,
    });
  });

  return { store420 };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  ThresholdPersistence420,
  wire420,
  PERSISTENCE_VERSION_420,
};

// ── Test exports ──────────────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'test') {
  module.exports._test420 = {
    sanitizeTopic420,
    validateThresholds420,
    ThresholdPersistence420,
    wire420,
  };
}
