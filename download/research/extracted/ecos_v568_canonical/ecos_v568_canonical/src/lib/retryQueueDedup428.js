'use strict';
/**
 * src/lib/retryQueueDedup428.js — ECOS V428
 *
 * Feature 2: Retry Queue Deduplication
 * Deduplicates retry queue entries by URL+payload hash on enqueue.
 * Exposes stats endpoint showing deduplicated count.
 *
 * Functions:
 *   configureRetryDedup428(opts)              — enable/disable, set hashAlgo
 *   computeRetryHash428(url, payload)         — compute dedup hash for a retry entry
 *   deduplicateEnqueue428(entry, queue)       — check + enqueue with dedup; returns {enqueued, duplicate, hash}
 *   getDedupStats428()                        — stats: totalChecked, duplicatesBlocked, uniqueEnqueued
 *   resetDedupStats428()                      — reset stats
 *   getDedupLog428(limit)                     — recent dedup events
 *   wireRetryQueueDedup428(app, opts, auditLog) — registers HTTP endpoints
 *
 * Endpoints: RQDEDUP01–RQDEDUP05 (5 endpoints)
 *
 * @version 428.0.0
 * R1: Sacred untouched. R2: All identifiers end in 428. R3: No new npm deps.
 */

const crypto = require('crypto');

const RETRY_DEDUP_VERSION428 = '428.0.0';
const DEFAULT_HASH_ALGO428 = 'sha256';

const _dedupState428 = {
  enabled:          true,
  hashAlgo:         DEFAULT_HASH_ALGO428,
  seenHashes:       new Map(),  // hash -> { firstSeenAt, url, count }
  log:              [],
  stats: {
    totalChecked:       0,
    duplicatesBlocked:  0,
    uniqueEnqueued:     0,
  },
};

// ─── helpers ────────────────────────────────────────────────────────────────

function _dedupLog428(event, data) {
  const entry = { ts: new Date().toISOString(), event, ...data };
  _dedupState428.log.push(entry);
  if (_dedupState428.log.length > 500) _dedupState428.log.shift();
}

// ─── public API ─────────────────────────────────────────────────────────────

/**
 * Configure deduplication.
 * @param {object} opts - { enabled, hashAlgo, maxSeenHashes }
 */
function configureRetryDedup428(opts) {
  const o = opts || {};
  if (o.enabled !== undefined) _dedupState428.enabled = Boolean(o.enabled);
  if (o.hashAlgo !== undefined) {
    const allowed = ['sha256', 'sha1', 'md5'];
    if (!allowed.includes(o.hashAlgo)) throw new Error('retryQueueDedup428: hashAlgo must be one of: ' + allowed.join(', '));
    _dedupState428.hashAlgo = o.hashAlgo;
  }
  if (o.maxSeenHashes !== undefined) {
    if (typeof o.maxSeenHashes !== 'number' || o.maxSeenHashes < 1) {
      throw new Error('retryQueueDedup428: maxSeenHashes must be a positive number');
    }
    _dedupState428.maxSeenHashes = o.maxSeenHashes;
  }
  _dedupLog428('configured428', { enabled: _dedupState428.enabled, hashAlgo: _dedupState428.hashAlgo });
  return { ok: true, enabled: _dedupState428.enabled, hashAlgo: _dedupState428.hashAlgo };
}

/**
 * Compute a dedup hash for a URL + payload combination.
 * @param {string} url
 * @param {any} payload
 * @returns {string} hex hash
 */
function computeRetryHash428(url, payload) {
  if (typeof url !== 'string') throw new Error('retryQueueDedup428: url must be a string');
  const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
  return crypto.createHash(_dedupState428.hashAlgo).update(url + '|' + payloadStr).digest('hex');
}

/**
 * Check for duplicate and enqueue if unique.
 * @param {object} entry - retry entry with url and payload fields
 * @param {Array}  queue - the in-memory retry queue array to push into
 * @returns {{ enqueued: boolean, duplicate: boolean, hash: string, dedupId428: string }}
 */
function deduplicateEnqueue428(entry, queue) {
  if (!entry || typeof entry !== 'object') throw new Error('retryQueueDedup428: entry must be an object');
  if (!Array.isArray(queue)) throw new Error('retryQueueDedup428: queue must be an array');

  const url     = entry.url || '';
  const payload = entry.payload || {};
  const hash    = computeRetryHash428(url, payload);
  const dedupId428 = 'dedup428_' + crypto.randomBytes(6).toString('hex');

  _dedupState428.stats.totalChecked++;

  if (_dedupState428.enabled && _dedupState428.seenHashes.has(hash)) {
    _dedupState428.stats.duplicatesBlocked++;
    const existing = _dedupState428.seenHashes.get(hash);
    existing.count++;
    _dedupLog428('duplicate_blocked428', { hash, url, dedupId428, count: existing.count });
    return { enqueued: false, duplicate: true, hash, dedupId428 };
  }

  // Register hash
  _dedupState428.seenHashes.set(hash, {
    firstSeenAt: new Date().toISOString(),
    url,
    count: 1,
  });

  // Prune if over limit
  const maxSeen = _dedupState428.maxSeenHashes || 10000;
  if (_dedupState428.seenHashes.size > maxSeen) {
    const firstKey = _dedupState428.seenHashes.keys().next().value;
    _dedupState428.seenHashes.delete(firstKey);
  }

  queue.push({ ...entry, dedupHash428: hash, dedupId428 });
  _dedupState428.stats.uniqueEnqueued++;
  _dedupLog428('enqueued428', { hash, url, dedupId428 });

  return { enqueued: true, duplicate: false, hash, dedupId428 };
}

/**
 * Get deduplication statistics.
 */
function getDedupStats428() {
  return {
    version: RETRY_DEDUP_VERSION428,
    enabled: _dedupState428.enabled,
    hashAlgo: _dedupState428.hashAlgo,
    seenHashCount: _dedupState428.seenHashes.size,
    stats: { ..._dedupState428.stats },
  };
}

/**
 * Reset dedup stats and seen-hashes map.
 */
function resetDedupStats428() {
  _dedupState428.seenHashes.clear();
  _dedupState428.stats.totalChecked      = 0;
  _dedupState428.stats.duplicatesBlocked = 0;
  _dedupState428.stats.uniqueEnqueued    = 0;
  _dedupLog428('reset428', {});
  return { ok: true, reset: true };
}

/**
 * Get recent dedup log entries.
 * @param {number} [limit=50]
 */
function getDedupLog428(limit) {
  const n = (typeof limit === 'number' && limit > 0) ? limit : 50;
  return _dedupState428.log.slice(-n);
}

// ─── wire ────────────────────────────────────────────────────────────────────

/**
 * Wire HTTP endpoints for retry queue deduplication.
 * RQDEDUP01 POST /api/v1/alerts/webhook/retry/dedup/enqueue
 * RQDEDUP02 GET  /api/v1/alerts/webhook/retry/dedup/stats
 * RQDEDUP03 POST /api/v1/alerts/webhook/retry/dedup/configure
 * RQDEDUP04 POST /api/v1/alerts/webhook/retry/dedup/reset
 * RQDEDUP05 GET  /api/v1/alerts/webhook/retry/dedup/log
 */
function wireRetryQueueDedup428(app, opts, auditLog) {
  const o = opts || {};
  if (o.enabled !== undefined || o.hashAlgo !== undefined) {
    configureRetryDedup428(o);
  }

  const BASE428 = '/api/v1/alerts/webhook/retry/dedup';

  // RQDEDUP01 — dedup-check enqueue (uses an internal scratch queue for demonstration)
  app.post(BASE428 + '/enqueue', (req, res) => {
    try {
      const body = req.body || {};
      if (!body.url) return res.status(400).json({ ok: false, error: 'url required' });
      const scratchQueue = [];
      const result = deduplicateEnqueue428(body, scratchQueue);
      if (auditLog && typeof auditLog.append === 'function') {
        try { auditLog.append({ type: 'retry_dedup_enqueue428', ...result }); } catch (_) {}
      }
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  // RQDEDUP02 — stats
  app.get(BASE428 + '/stats', (req, res) => {
    try {
      res.json(getDedupStats428());
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // RQDEDUP03 — configure
  app.post(BASE428 + '/configure', (req, res) => {
    try {
      const body = req.body || {};
      const result = configureRetryDedup428(body);
      res.json(result);
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  // RQDEDUP04 — reset
  app.post(BASE428 + '/reset', (req, res) => {
    try {
      const result = resetDedupStats428();
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // RQDEDUP05 — log
  app.get(BASE428 + '/log', (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
      res.json({ ok: true, log: getDedupLog428(limit) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}

// ─── exports ─────────────────────────────────────────────────────────────────

module.exports = {
  RETRY_DEDUP_VERSION428,
  DEFAULT_HASH_ALGO428,
  _dedupState428,
  configureRetryDedup428,
  computeRetryHash428,
  deduplicateEnqueue428,
  getDedupStats428,
  resetDedupStats428,
  getDedupLog428,
  wireRetryQueueDedup428,
};
